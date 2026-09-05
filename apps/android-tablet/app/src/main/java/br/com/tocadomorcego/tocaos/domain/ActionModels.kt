package br.com.tocadomorcego.tocaos.domain

enum class ActionType {
    CREATE_CONTENT,
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
)

data class ActionEvent(
    val sequence: Int,
    val label: String,
    val state: ActionState,
)
