package br.com.tocadomorcego.tocaos.data

data class AppSessionProfile(
    val subject: String,
    val tenantId: String? = null,
    val roles: List<String> = emptyList(),
    val authorizationSource: String = "SERVER_PRINCIPAL_MAPPER",
    val capabilityAuthority: String = "TOCA_CORE_RUNTIME",
    val executionBoundary: String = "PREPARE_ONLY",
)

interface MutableAppSessionTokenStore : AppSessionTokenProvider {
    fun bind(token: String)
    fun clear()
    fun hasSession(): Boolean
}

class MemoryAppSessionTokenStore : MutableAppSessionTokenStore {
    @Volatile
    private var token: String? = null

    override fun bind(token: String) {
        val normalized = token.trim()
        require(normalized.isNotEmpty()) { "APP_SESSION_TOKEN_REQUIRED" }
        require(!normalized.contains('\r') && !normalized.contains('\n')) {
            "APP_SESSION_TOKEN_INVALID"
        }
        this.token = normalized
    }

    override fun clear() {
        token = null
    }

    override fun hasSession(): Boolean = token != null

    override fun appSessionToken(): String = token ?: throw AppSessionRequiredException()
}

class AppSessionRequiredException(
    message: String = "APP_SESSION_REQUIRED",
) : IllegalStateException(message)
