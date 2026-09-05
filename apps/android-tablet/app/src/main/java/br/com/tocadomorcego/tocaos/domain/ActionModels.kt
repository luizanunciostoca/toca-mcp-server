package br.com.tocadomorcego.tocaos.domain

enum class ActionType {
    CREATE_CONTENT,
    CREATE_VIDEO,
    PLAN_CONTENT,
    PUBLISH_SCHEDULE,
    META_ADS,
    SOCIAL_INBOX,
    MEDIA_LIBRARY,
    ANALYTICS,
    COMMERCIAL,
    OPERATIONS,
    DOCUMENTS,
}

enum class ActionMode { AUTO, GUIDED, ADVANCED }

enum class ActionAvailability { AVAILABLE, LIMITED, UNAVAILABLE, BLOCKED }

enum class ActionState {
    DRAFT,
    READY,
    APPROVAL_REQUIRED,
    RUNNING,
    BLOCKED,
    UNCERTAIN,
    COMPLETED,
    FAILED,
}

enum class VideoCreationRoute {
    REAL_FOOTAGE_FILM,
    PHOTO_MOTION,
    IMAGE_TO_VIDEO_SOURCE_BOUND,
    MULTI_SHOT_SOURCE_BOUND,
    HYBRID_GENERATIVE_EDITORIAL,
    DIRECTORS_CUT_RECUT,
    EDITORIAL_MOTION,
    DUAL_TRACK_FILM,
    SPOTLIGHT_MONOTHEMATIC,
    SYNTHETIC_TEXT_TO_VIDEO_RESTRICTED,
}

data class VideoCreationOption(
    val route: VideoCreationRoute,
    val title: String,
    val description: String,
    val availabilityLabel: String,
    val restricted: Boolean,
)

val VIDEO_CREATION_OPTIONS = listOf(
    VideoCreationOption(
        route = VideoCreationRoute.REAL_FOOTAGE_FILM,
        title = "Filme com footage real",
        description = "Edição cinematográfica com vídeos reais já captados.",
        availabilityLabel = "DISPONÍVEL",
        restricted = false,
    ),
    VideoCreationOption(
        route = VideoCreationRoute.PHOTO_MOTION,
        title = "Photo motion",
        description = "Anima fotografia real com movimento de câmera e parallax.",
        availabilityLabel = "DISPONÍVEL",
        restricted = false,
    ),
    VideoCreationOption(
        route = VideoCreationRoute.IMAGE_TO_VIDEO_SOURCE_BOUND,
        title = "Image-to-video source-bound",
        description = "Expande foto real em movimento sem inventar marca, local ou fatos.",
        availabilityLabel = "DISPONÍVEL",
        restricted = false,
    ),
    VideoCreationOption(
        route = VideoCreationRoute.MULTI_SHOT_SOURCE_BOUND,
        title = "Multi-shot source-bound",
        description = "Combina várias fontes reais em sequência generativa coerente.",
        availabilityLabel = "DISPONÍVEL",
        restricted = false,
    ),
    VideoCreationOption(
        route = VideoCreationRoute.HYBRID_GENERATIVE_EDITORIAL,
        title = "Híbrido generativo + editorial",
        description = "IA cria movimento; branding, texto e CTA entram deterministicamente.",
        availabilityLabel = "DISPONÍVEL",
        restricted = false,
    ),
    VideoCreationOption(
        route = VideoCreationRoute.DIRECTORS_CUT_RECUT,
        title = "Director's Cut / Recut",
        description = "Reedita masters e footage existentes antes de gerar material novo.",
        availabilityLabel = "DISPONÍVEL",
        restricted = false,
    ),
    VideoCreationOption(
        route = VideoCreationRoute.EDITORIAL_MOTION,
        title = "Editorial motion",
        description = "Tipografia, máscaras, wipes, linhas, crops, reveals e ritmo.",
        availabilityLabel = "DISPONÍVEL",
        restricted = false,
    ),
    VideoCreationOption(
        route = VideoCreationRoute.DUAL_TRACK_FILM,
        title = "Dual Track Film",
        description = "Narrativa para experiências paralelas sem virar slideshow.",
        availabilityLabel = "DISPONÍVEL",
        restricted = false,
    ),
    VideoCreationOption(
        route = VideoCreationRoute.SPOTLIGHT_MONOTHEMATIC,
        title = "Spotlight monotemático",
        description = "Filme centrado em DJ, artista, crowd, drinks, venue ou foco único.",
        availabilityLabel = "DISPONÍVEL",
        restricted = false,
    ),
    VideoCreationOption(
        route = VideoCreationRoute.SYNTHETIC_TEXT_TO_VIDEO_RESTRICTED,
        title = "Text-to-video sintético",
        description = "Uso não factual/abstrato; não substitui footage real do local/evento.",
        availabilityLabel = "RESTRITO",
        restricted = true,
    ),
)

fun VideoCreationRoute.displayTitle(): String =
    VIDEO_CREATION_OPTIONS.first { it.route == this }.title

data class ApprovalPreview(
    val approvalId: String,
    val capabilityId: String,
    val routeId: String,
    val targetAccount: String,
    val descriptorSha256: String,
    val financialCeiling: Double? = null,
    val expiresAt: String,
    val status: String,
)

data class ActionCard(
    val type: ActionType,
    val title: String,
    val description: String,
    val availability: ActionAvailability,
    val defaultMode: ActionMode,
    val approvalHint: Boolean = false,
    val reason: String? = null,
)

data class TocaActionRequest(
    val actionType: ActionType,
    val operation: String,
    val objective: String,
    val mode: ActionMode,
    val inputs: Map<String, String> = emptyMap(),
)

data class TocaAction(
    val actionId: String,
    val correlationId: String,
    val request: TocaActionRequest,
    val state: ActionState,
    val approvalPreview: ApprovalPreview? = null,
)

data class ActionEvent(
    val sequence: Int,
    val label: String,
    val state: ActionState,
)
