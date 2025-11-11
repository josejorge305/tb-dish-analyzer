export default {
  async queue(batch, env, ctx) {
    for (const msg of batch.messages) {
      console.log("Q MESSAGE:", msg.body);
    }
  },
};
