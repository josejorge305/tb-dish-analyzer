// ===========================================
// SwiftUI Example: Restaurant AI Organ Display
// 10 Organs with Medical Explanations
// ===========================================
// This is a reference implementation showing how to display
// the enriched organ impact data from the API.

import SwiftUI

// MARK: - Data Models

struct OrganAnalysisResponse: Codable {
    let ok: Bool
    let dish: String
    let tummy_barometer: Int
    let barometer_color: String
    let organ_levels: [String: String]
    let organ_bars: [String: Int]
    let organ_colors: [String: String]
    let organ_scores: [String: Double]?
    let organ_medical_summaries: [String: String?]?
    let organ_details: [String: OrganDetail]?
    let compound_interactions: [CompoundInteraction]?
    let insight_lines: [String]
}

struct OrganDetail: Codable {
    let level: String
    let score: Double
    let summary: String?
    let top_compounds: [CompoundInfo]?
    let compounds: [String]?
    let has_medical_detail: Bool
}

struct CompoundInfo: Codable {
    let name: String
    let effect: String
    let mechanism: String?
    let explanation: String?
    let citations: String?
}

struct CompoundInteraction: Codable {
    let compounds: [String]
    let type: String
    let description: String?
    let mechanism: String?
    let strength: Double?
    let organs_affected: [String]?
}

// MARK: - Organ Configuration

struct OrganConfig {
    let key: String
    let displayName: String
    let icon: String
    let systemName: String // SF Symbol

    static let all: [OrganConfig] = [
        OrganConfig(key: "brain", displayName: "Brain", icon: "🧠", systemName: "brain.head.profile"),
        OrganConfig(key: "heart", displayName: "Heart", icon: "❤️", systemName: "heart.fill"),
        OrganConfig(key: "liver", displayName: "Liver", icon: "🫀", systemName: "liver.fill"),
        OrganConfig(key: "gut", displayName: "Gut", icon: "🦠", systemName: "stomach.fill"),
        OrganConfig(key: "kidney", displayName: "Kidneys", icon: "🫘", systemName: "kidney.fill"),
        OrganConfig(key: "immune", displayName: "Immune", icon: "🛡️", systemName: "shield.checkered"),
        OrganConfig(key: "eyes", displayName: "Eyes", icon: "👁️", systemName: "eye.fill"),
        OrganConfig(key: "skin", displayName: "Skin", icon: "✨", systemName: "hand.raised.fill"),
        OrganConfig(key: "bones", displayName: "Bones", icon: "🦴", systemName: "figure.stand"),
        OrganConfig(key: "thyroid", displayName: "Thyroid", icon: "🦋", systemName: "bolt.heart.fill")
    ]
}

// MARK: - Color Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6: // RGB
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 128, 128, 128)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - Main View

struct OrganDashboardView: View {
    let response: OrganAnalysisResponse
    @State private var selectedOrgan: OrganConfig?
    @State private var showingDetail = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Header with Tummy Barometer
                BarometerHeaderView(
                    score: response.tummy_barometer,
                    color: response.barometer_color,
                    dishName: response.dish
                )

                // Compound Interactions Banner (if any)
                if let interactions = response.compound_interactions, !interactions.isEmpty {
                    InteractionsBannerView(interactions: interactions)
                }

                // Organ Grid (2 columns)
                LazyVGrid(columns: [
                    GridItem(.flexible()),
                    GridItem(.flexible())
                ], spacing: 16) {
                    ForEach(OrganConfig.all, id: \.key) { organ in
                        OrganCardView(
                            organ: organ,
                            level: response.organ_levels[organ.key] ?? "Neutral",
                            bar: response.organ_bars[organ.key] ?? 0,
                            color: response.organ_colors[organ.key] ?? "#a1a1aa",
                            score: response.organ_scores?[organ.key] ?? 0,
                            summary: response.organ_medical_summaries?[organ.key] ?? nil,
                            detail: response.organ_details?[organ.key]
                        )
                        .onTapGesture {
                            selectedOrgan = organ
                            showingDetail = true
                        }
                    }
                }
                .padding(.horizontal)

                // Insight Lines
                InsightLinesView(lines: response.insight_lines)
            }
            .padding(.vertical)
        }
        .sheet(isPresented: $showingDetail) {
            if let organ = selectedOrgan {
                OrganDetailSheet(
                    organ: organ,
                    detail: response.organ_details?[organ.key],
                    interactions: response.compound_interactions?.filter {
                        $0.organs_affected?.contains(organ.key) ?? false
                    } ?? []
                )
            }
        }
    }
}

// MARK: - Barometer Header

struct BarometerHeaderView: View {
    let score: Int
    let color: String
    let dishName: String

    var body: some View {
        VStack(spacing: 12) {
            Text(dishName)
                .font(.title2)
                .fontWeight(.semibold)

            ZStack {
                Circle()
                    .stroke(Color.gray.opacity(0.2), lineWidth: 12)
                    .frame(width: 120, height: 120)

                Circle()
                    .trim(from: 0, to: CGFloat(min(max(score + 80, 0), 160)) / 160)
                    .stroke(Color(hex: color), style: StrokeStyle(lineWidth: 12, lineCap: .round))
                    .frame(width: 120, height: 120)
                    .rotationEffect(.degrees(-90))

                VStack(spacing: 2) {
                    Text("\(score)")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                        .foregroundColor(Color(hex: color))
                    Text("Score")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Text(scoreDescription(score))
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
        .padding(.horizontal)
    }

    func scoreDescription(_ score: Int) -> String {
        switch score {
        case 60...100: return "Excellent for your health"
        case 40..<60: return "Good overall impact"
        case 20..<40: return "Moderate benefits"
        case 0..<20: return "Balanced impact"
        case -20..<0: return "Some concerns"
        case -40..<(-20): return "Use caution"
        default: return "Significant concerns"
        }
    }
}

// MARK: - Organ Card

struct OrganCardView: View {
    let organ: OrganConfig
    let level: String
    let bar: Int
    let color: String
    let score: Double
    let summary: String?
    let detail: OrganDetail?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header row
            HStack {
                Image(systemName: organ.systemName)
                    .font(.title2)
                    .foregroundColor(Color(hex: color))

                Spacer()

                Text(organ.icon)
                    .font(.title3)
            }

            Text(organ.displayName)
                .font(.headline)

            Text(level)
                .font(.subheadline)
                .foregroundColor(Color(hex: color))
                .fontWeight(.medium)

            // Bar indicator
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    // Background
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.gray.opacity(0.2))
                        .frame(height: 8)

                    // Filled portion
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color(hex: color))
                        .frame(width: barWidth(for: bar, in: geometry.size.width), height: 8)
                }
            }
            .frame(height: 8)

            // Summary preview (if available)
            if let summary = summary {
                Text(summary)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }

            // Compound count badge
            if let detail = detail, let compounds = detail.compounds, !compounds.isEmpty {
                HStack {
                    Image(systemName: "atom")
                        .font(.caption2)
                    Text("\(compounds.count) compounds")
                        .font(.caption2)
                }
                .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
    }

    func barWidth(for value: Int, in totalWidth: CGFloat) -> CGFloat {
        // Map -80 to +80 to 0% to 100%
        let normalized = CGFloat(value + 80) / 160.0
        return totalWidth * max(0, min(1, normalized))
    }
}

// MARK: - Compound Interactions Banner

struct InteractionsBannerView: View {
    let interactions: [CompoundInteraction]

    var synergies: [CompoundInteraction] {
        interactions.filter { $0.type == "synergy" || $0.type == "absorption_enhance" }
    }

    var antagonisms: [CompoundInteraction] {
        interactions.filter { $0.type == "antagonism" || $0.type == "absorption_block" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !synergies.isEmpty {
                HStack {
                    Image(systemName: "plus.circle.fill")
                        .foregroundColor(.green)
                    Text("Synergies Found")
                        .font(.subheadline)
                        .fontWeight(.medium)
                }

                ForEach(synergies.prefix(2), id: \.description) { interaction in
                    Text("• \(interaction.compounds.joined(separator: " + ")): \(interaction.description ?? "")")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            if !antagonisms.isEmpty {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.orange)
                    Text("Interactions to Note")
                        .font(.subheadline)
                        .fontWeight(.medium)
                }

                ForEach(antagonisms.prefix(2), id: \.description) { interaction in
                    Text("• \(interaction.compounds.joined(separator: " & ")): \(interaction.description ?? "")")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
        .padding(.horizontal)
    }
}

// MARK: - Organ Detail Sheet

struct OrganDetailSheet: View {
    let organ: OrganConfig
    let detail: OrganDetail?
    let interactions: [CompoundInteraction]
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header
                    HStack {
                        Text(organ.icon)
                            .font(.largeTitle)
                        VStack(alignment: .leading) {
                            Text(organ.displayName)
                                .font(.title)
                                .fontWeight(.bold)
                            if let detail = detail {
                                Text(detail.level)
                                    .font(.headline)
                                    .foregroundColor(levelColor(detail.level))
                            }
                        }
                        Spacer()
                    }
                    .padding(.bottom)

                    // Medical Summary
                    if let summary = detail?.summary {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("Medical Insight", systemImage: "stethoscope")
                                .font(.headline)
                            Text(summary)
                                .font(.body)
                                .foregroundColor(.secondary)
                        }
                        .padding()
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(12)
                    }

                    // Top Compounds
                    if let compounds = detail?.top_compounds, !compounds.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Key Compounds", systemImage: "atom")
                                .font(.headline)

                            ForEach(compounds, id: \.name) { compound in
                                CompoundRowView(compound: compound)
                            }
                        }
                    }

                    // Interactions for this organ
                    if !interactions.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Compound Interactions", systemImage: "arrow.triangle.2.circlepath")
                                .font(.headline)

                            ForEach(interactions, id: \.description) { interaction in
                                InteractionRowView(interaction: interaction)
                            }
                        }
                    }

                    Spacer()
                }
                .padding()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    func levelColor(_ level: String) -> Color {
        switch level {
        case "High Benefit": return Color(hex: "#16a34a")
        case "Benefit": return Color(hex: "#22c55e")
        case "Mild Benefit": return Color(hex: "#86efac")
        case "Neutral": return Color(hex: "#a1a1aa")
        case "Mild Caution": return Color(hex: "#fcd34d")
        case "Caution": return Color(hex: "#f59e0b")
        case "High Caution": return Color(hex: "#dc2626")
        default: return Color(hex: "#a1a1aa")
        }
    }
}

// MARK: - Compound Row

struct CompoundRowView: View {
    let compound: CompoundInfo
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: { withAnimation { expanded.toggle() } }) {
                HStack {
                    Circle()
                        .fill(compound.effect == "benefit" ? Color.green : Color.orange)
                        .frame(width: 8, height: 8)

                    Text(compound.name)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)

                    Spacer()

                    if compound.mechanism != nil || compound.explanation != nil {
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }

            if expanded {
                VStack(alignment: .leading, spacing: 6) {
                    if let mechanism = compound.mechanism {
                        HStack(alignment: .top) {
                            Text("Mechanism:")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(mechanism)
                                .font(.caption)
                        }
                    }

                    if let explanation = compound.explanation {
                        Text(explanation)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    if let citations = compound.citations, !citations.isEmpty {
                        HStack {
                            Image(systemName: "doc.text")
                                .font(.caption2)
                            Text(citations)
                                .font(.caption2)
                        }
                        .foregroundColor(.blue)
                    }
                }
                .padding(.leading, 16)
            }
        }
        .padding()
        .background(Color(.tertiarySystemBackground))
        .cornerRadius(8)
    }
}

// MARK: - Interaction Row

struct InteractionRowView: View {
    let interaction: CompoundInteraction

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: interaction.type.contains("synerg") || interaction.type.contains("enhance")
                      ? "plus.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundColor(interaction.type.contains("synerg") || interaction.type.contains("enhance")
                                     ? .green : .orange)

                Text(interaction.compounds.joined(separator: " + "))
                    .font(.subheadline)
                    .fontWeight(.medium)
            }

            if let desc = interaction.description {
                Text(desc)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.tertiarySystemBackground))
        .cornerRadius(8)
    }
}

// MARK: - Insight Lines

struct InsightLinesView: View {
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Key Insights")
                .font(.headline)

            ForEach(lines, id: \.self) { line in
                HStack(alignment: .top) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                        .font(.caption)
                    Text(line)
                        .font(.subheadline)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
        .padding(.horizontal)
    }
}

// MARK: - Preview

struct OrganDashboardView_Previews: PreviewProvider {
    static var previews: some View {
        // Sample response for preview
        let sampleResponse = OrganAnalysisResponse(
            ok: true,
            dish: "Grilled Salmon with Broccoli",
            tummy_barometer: 65,
            barometer_color: "#16a34a",
            organ_levels: [
                "brain": "High Benefit",
                "heart": "Benefit",
                "liver": "Benefit",
                "gut": "Mild Benefit",
                "kidney": "Neutral",
                "immune": "Benefit",
                "eyes": "High Benefit",
                "skin": "Benefit",
                "bones": "Mild Benefit",
                "thyroid": "Benefit"
            ],
            organ_bars: [
                "brain": 80, "heart": 40, "liver": 40, "gut": 20,
                "kidney": 0, "immune": 40, "eyes": 80, "skin": 40,
                "bones": 20, "thyroid": 40
            ],
            organ_colors: [
                "brain": "#16a34a", "heart": "#22c55e", "liver": "#22c55e",
                "gut": "#86efac", "kidney": "#a1a1aa", "immune": "#22c55e",
                "eyes": "#16a34a", "skin": "#22c55e", "bones": "#86efac",
                "thyroid": "#22c55e"
            ],
            organ_scores: ["brain": 2.85, "heart": 1.5, "eyes": 2.5],
            organ_medical_summaries: [
                "brain": "Supports brain health through membrane fluidity and anti-inflammatory pathways. DHA constitutes 40% of brain polyunsaturated fatty acids.",
                "eyes": "Rich in lutein and DHA for macular protection and retinal health."
            ],
            organ_details: [
                "brain": OrganDetail(
                    level: "High Benefit",
                    score: 2.85,
                    summary: "Supports brain health through membrane fluidity and neuroprotection.",
                    top_compounds: [
                        CompoundInfo(
                            name: "DHA (Omega-3)",
                            effect: "benefit",
                            mechanism: "membrane fluidity, anti-inflammatory",
                            explanation: "DHA constitutes 40% of brain polyunsaturated fatty acids and is critical for neuronal membrane integrity.",
                            citations: "PMID:28899506"
                        )
                    ],
                    compounds: ["DHA", "EPA", "Sulforaphane"],
                    has_medical_detail: true
                )
            ],
            compound_interactions: [
                CompoundInteraction(
                    compounds: ["DHA", "Curcumin"],
                    type: "synergy",
                    description: "Synergistic anti-inflammatory and neuroprotective effects",
                    mechanism: "Both target overlapping inflammatory pathways",
                    strength: 0.8,
                    organs_affected: ["brain"]
                )
            ],
            insight_lines: [
                "Brain: omega-3 fatty acids, sulforaphane",
                "Eyes: lutein, DHA",
                "Heart: omega-3, fiber"
            ]
        )

        OrganDashboardView(response: sampleResponse)
    }
}
