package br.com.tocadomorcego.tocaos.data

import br.com.tocadomorcego.tocaos.domain.ActionAvailability
import br.com.tocadomorcego.tocaos.domain.ActionCard
import br.com.tocadomorcego.tocaos.domain.ActionMode
import br.com.tocadomorcego.tocaos.domain.ActionState
import br.com.tocadomorcego.tocaos.domain.ActionStatusSnapshot
import br.com.tocadomorcego.tocaos.domain.ActionType
import br.com.tocadomorcego.tocaos.domain.ApprovalPreview
import br.com.tocadomorcego.tocaos.domain.TocaAction
import br.com.tocadomorcego.tocaos.domain.TocaActionRequest
import br.com.tocadomorcego.tocaos.domain.VideoCreationOption
import br.com.tocadomorcego.tocaos.domain.VideoCreationRoute
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

private val SAFE_ACTION_ID = Regex("^[A-Za-z0-9._:-]{1,200}$")

fun interface AppSessionTokenProvider {
    fun appSessionToken(): String
}

internal fun interface AppGatewayTransport {
    fun request(request: AppGatewayTransportRequest): String
}

internal data class AppGatewayTransportRequest(
    val path: String,
    val method: String,
    val jsonBody: String? = null,
)

/**
 * Client for the TOCA App Gateway. Provider credentials must never be supplied to or stored by the
 * Android application. The default transport carries only the TOCA app-session bearer token.
 */
class AppGatewayHttpClient private constructor(
    private val transport: AppGatewayTransport,
) {
    constructor(
        baseUrl: String,
        sessionTokenProvider: AppSessionTokenProvider,
    ) : this(HttpUrlConnectionAppGatewayTransport(baseUrl, sessionTokenProvider))

    internal constructor(request: (AppGatewayTransportRequest) -> String) : this(
        AppGatewayTransport(request),
    )

    fun fetchSessionProfile(): AppSessionProfile {
        val body = transport.request(AppGatewayTransportRequest("/api/v1/session", "GET"))
        val session = JSONObject(body).getJSONObject("session")
        return AppSessionProfile(
            subject = session.getString("subject"),
            tenantId = session.optString("tenant_id").takeIf(String::isNotBlank),
            roles = session.optJSONArray("roles")?.stringValues().orEmpty(),
            authorizationSource = session.optString(
                "authorization_source",
                "SERVER_PRINCIPAL_MAPPER",
            ),
            capabilityAuthority = session.optString(
                "capability_authority",
                "TOCA_CORE_RUNTIME",
            ),
            executionBoundary = session.optString("execution_boundary", "PREPARE_ONLY"),
        )
    }

    fun fetchActionCards(): List<ActionCard> {
        val body = transport.request(AppGatewayTransportRequest("/api/v1/capabilities", "GET"))
        val actions = JSONObject(body).getJSONArray("actions")
        return actions.mapObjects(::parseActionCard)
    }

    fun fetchVideoOptions(): List<VideoCreationOption> {
        val body = transport.request(AppGatewayTransportRequest("/api/v1/video-options", "GET"))
        val options = JSONObject(body).getJSONArray("video_options")
        return options.mapObjects(::parseVideoOption)
    }

    fun fetchActionStatus(actionId: String): ActionStatusSnapshot {
        val normalizedActionId = actionId.trim()
        require(SAFE_ACTION_ID.matches(normalizedActionId)) { "APP_GATEWAY_ACTION_ID_INVALID" }

        val body = JSONObject(
            transport.request(
                AppGatewayTransportRequest("/api/v1/actions/$normalizedActionId", "GET"),
            ),
        )
        val action = body.getJSONObject("action")
        return ActionStatusSnapshot(
            actionId = action.getString("action_id"),
            correlationId = action.getString("correlation_id"),
            state = ActionState.valueOf(action.getString("state")),
            availability = ActionAvailability.valueOf(action.getString("availability")),
            approvalHint = action.optBoolean("approval_hint", false),
            reasons = action.optJSONArray("reasons")?.stringValues().orEmpty(),
            createdAt = action.getString("created_at"),
            persistence = body.optString("persistence", "IN_MEMORY_RUNTIME_ONLY"),
        )
    }

    fun prepare(actionRequest: TocaActionRequest): TocaAction {
        val payload = JSONObject()
        actionRequest.inputs.forEach { (key, value) -> payload.put(key, value) }

        val requestBody = JSONObject()
            .put("action_type", actionRequest.actionType.name)
            .put("operation", actionRequest.operation)
            .put("objective", actionRequest.objective)
            .put("mode", actionRequest.mode.name)
            .put("payload", payload)
            .put("client_request_id", UUID.randomUUID().toString())

        if (actionRequest.actionType == ActionType.CREATE_VIDEO) {
            val route = actionRequest.inputs["video_route"]
                ?.takeIf(String::isNotBlank)
                ?: throw IllegalArgumentException("VIDEO_CREATION_ROUTE_REQUIRED")
            requestBody.put("video_route", route)
        }

        val body = transport.request(
            AppGatewayTransportRequest(
                path = "/api/v1/actions",
                method = "POST",
                jsonBody = requestBody.toString(),
            ),
        )
        val action = JSONObject(body).getJSONObject("action")
        return TocaAction(
            actionId = action.getString("action_id"),
            correlationId = action.getString("correlation_id"),
            request = actionRequest,
            state = ActionState.valueOf(action.getString("state")),
            approvalPreview = action.optJSONObject("approval_preview")?.let(::parseApprovalPreview),
        )
    }

    private fun parseActionCard(value: JSONObject): ActionCard = ActionCard(
        type = ActionType.valueOf(value.getString("action_type")),
        title = value.getString("title"),
        description = value.getString("description"),
        availability = ActionAvailability.valueOf(value.getString("availability")),
        defaultMode = ActionMode.valueOf(value.getString("default_mode")),
        approvalHint = value.optBoolean("approval_hint", false),
        reason = value.optJSONArray("reasons")?.firstStringOrNull(),
    )

    private fun parseVideoOption(value: JSONObject): VideoCreationOption = VideoCreationOption(
        route = VideoCreationRoute.valueOf(value.getString("route")),
        title = value.getString("title"),
        description = value.getString("description"),
        availabilityLabel = value.getString("availability"),
        restricted = value.optBoolean("restricted", false),
    )

    private fun parseApprovalPreview(value: JSONObject): ApprovalPreview = ApprovalPreview(
        approvalId = value.getString("approval_id"),
        capabilityId = value.getString("capability_id"),
        routeId = value.getString("route_id"),
        targetAccount = value.getString("target_account"),
        descriptorSha256 = value.getString("descriptor_sha256"),
        financialCeiling = if (value.has("financial_ceiling")) value.getDouble("financial_ceiling") else null,
        expiresAt = value.getString("expires_at"),
        status = value.getString("status"),
    )
}

private class HttpUrlConnectionAppGatewayTransport(
    baseUrl: String,
    private val sessionTokenProvider: AppSessionTokenProvider,
) : AppGatewayTransport {
    private val origin = AppGatewayEndpointPolicy.normalizeBaseUrl(baseUrl)

    override fun request(request: AppGatewayTransportRequest): String {
        val token = sessionTokenProvider.appSessionToken().trim()
        require(token.isNotEmpty()) { "APP_SESSION_TOKEN_REQUIRED" }
        require(!token.contains('\r') && !token.contains('\n')) { "APP_SESSION_TOKEN_INVALID" }

        val connection = URL("$origin${request.path}").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = request.method
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.useCaches = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")

            if (request.jsonBody != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { output ->
                    output.write(request.jsonBody.toByteArray(Charsets.UTF_8))
                }
            }

            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val safeCode = runCatching { JSONObject(responseBody).optString("error") }
                    .getOrNull()
                    ?.takeIf(String::isNotBlank)
                    ?: "APP_GATEWAY_HTTP_ERROR"
                throw AppGatewayHttpException(status, safeCode)
            }
            return responseBody
        } finally {
            connection.disconnect()
        }
    }
}

class AppGatewayHttpException(
    val statusCode: Int,
    val safeCode: String,
) : RuntimeException("APP_GATEWAY_HTTP_$statusCode:$safeCode")

object AppGatewayEndpointPolicy {
    fun normalizeBaseUrl(raw: String): String {
        val value = raw.trim()
        require(value.isNotEmpty()) { "APP_GATEWAY_BASE_URL_REQUIRED" }
        val uri = URI(value)
        val scheme = uri.scheme?.lowercase() ?: throw IllegalArgumentException("APP_GATEWAY_SCHEME_REQUIRED")
        val host = uri.host?.lowercase() ?: throw IllegalArgumentException("APP_GATEWAY_HOST_REQUIRED")
        require(uri.userInfo == null && uri.query == null && uri.fragment == null) {
            "APP_GATEWAY_BASE_URL_INVALID"
        }
        require(uri.path.isNullOrEmpty() || uri.path == "/") { "APP_GATEWAY_BASE_URL_PATH_FORBIDDEN" }

        val loopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
        require(scheme == "https" || (scheme == "http" && loopback)) {
            "APP_GATEWAY_HTTPS_REQUIRED"
        }

        val authority = if (uri.port >= 0) "${uri.rawHostForAuthority()}:${uri.port}" else uri.rawHostForAuthority()
        return "$scheme://$authority"
    }

    private fun URI.rawHostForAuthority(): String =
        if (host.contains(':')) "[$host]" else host
}

private fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> =
    buildList(length()) {
        for (index in 0 until length()) add(transform(getJSONObject(index)))
    }

private fun JSONArray.stringValues(): List<String> =
    buildList(length()) {
        for (index in 0 until length()) {
            optString(index).takeIf(String::isNotBlank)?.let(::add)
        }
    }

private fun JSONArray.firstStringOrNull(): String? =
    if (length() > 0) optString(0).takeIf(String::isNotBlank) else null
