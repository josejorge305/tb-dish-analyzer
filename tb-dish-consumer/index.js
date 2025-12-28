/**
 * Dish Analysis Queue Consumer
 *
 * Processes queued dish analysis jobs in parallel.
 * When dishes are enqueued (e.g., from menu extraction), this worker
 * processes them in batches and caches the results.
 *
 * Flow:
 * 1. Receive batch of messages from queue
 * 2. Process dishes in parallel (up to batch size)
 * 3. Call main worker to analyze each dish
 * 4. Store results in R2 and KV cache
 * 5. Ack messages on success, retry on failure
 */

async function r2WriteJSON(env, key, obj) {
  if (!env?.R2_BUCKET) throw new Error("R2_BUCKET not bound");
  await env.R2_BUCKET.put(key, JSON.stringify(obj), {
    httpMetadata: { contentType: "application/json" }
  });
}

async function r2ReadJSON(env, key) {
  if (!env?.R2_BUCKET || !key) return null;
  try {
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) return null;
    return await obj.json();
  } catch {
    return null;
  }
}

export default {
  async queue(batch, env, ctx) {
    console.log(`Processing ${batch.messages.length} queued dish analysis jobs`);

    const results = await Promise.allSettled(
      batch.messages.map(async (msg) => {
        const startTime = Date.now();
        let jobData;

        try {
          // Parse message body
          jobData = typeof msg.body === "string" ? JSON.parse(msg.body) : msg.body;
          const jobId = jobData.id || `queue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

          console.log(`Processing job ${jobId}: ${jobData.dish_name}`);

          // Update status to processing
          await r2WriteJSON(env, `results/${jobId}.json`, {
            id: jobId,
            status: "processing",
            started_at: new Date().toISOString(),
            dish_name: jobData.dish_name,
            place_id: jobData.place_id
          });

          // Call main worker to analyze the dish
          const analysisPayload = {
            dishName: jobData.dish_name,
            restaurantName: jobData.restaurant_name || "",
            menuDescription: jobData.dish_desc || "",
            cuisine: jobData.cuisine || "",
            placeId: jobData.place_id || "",
            skip_organs: true // Faster processing, organs can be lazy-loaded
          };

          let result;
          if (env.DISH_PROCESSOR) {
            // Use service binding (preferred - no network hop)
            const response = await env.DISH_PROCESSOR.fetch(
              "https://internal/pipeline/analyze-dish",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(analysisPayload)
              }
            );
            result = await response.json();
          } else {
            // Fallback to external call
            const response = await fetch(
              "https://tb-dish-processor.tummybuddy.workers.dev/pipeline/analyze-dish",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(analysisPayload)
              }
            );
            result = await response.json();
          }

          const processingMs = Date.now() - startTime;

          if (result?.ok) {
            // Write completed result
            await r2WriteJSON(env, `results/${jobId}.json`, {
              id: jobId,
              status: "completed",
              completed_at: new Date().toISOString(),
              processing_ms: processingMs,
              dish_name: jobData.dish_name,
              place_id: jobData.place_id,
              result: result
            });

            console.log(`Job ${jobId} completed in ${processingMs}ms`);
            msg.ack();
            return { ok: true, jobId, processingMs };
          } else {
            // Analysis returned error
            await r2WriteJSON(env, `results/${jobId}.json`, {
              id: jobId,
              status: "failed",
              failed_at: new Date().toISOString(),
              processing_ms: processingMs,
              dish_name: jobData.dish_name,
              error: result?.error || "analysis_failed"
            });

            console.error(`Job ${jobId} failed: ${result?.error}`);
            msg.retry(); // Retry the message
            return { ok: false, jobId, error: result?.error };
          }
        } catch (err) {
          const processingMs = Date.now() - startTime;
          const jobId = jobData?.id || "unknown";

          console.error(`Job ${jobId} error: ${err.message}`);

          // Write error status
          if (jobData?.id) {
            await r2WriteJSON(env, `results/${jobId}.json`, {
              id: jobId,
              status: "error",
              error_at: new Date().toISOString(),
              processing_ms: processingMs,
              dish_name: jobData?.dish_name,
              error: String(err?.message || err)
            });
          }

          msg.retry(); // Retry the message
          return { ok: false, jobId, error: String(err?.message || err) };
        }
      })
    );

    const succeeded = results.filter(r => r.status === "fulfilled" && r.value?.ok).length;
    const failed = results.length - succeeded;

    console.log(`Batch complete: ${succeeded} succeeded, ${failed} failed`);
  }
};
