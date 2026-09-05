package br.com.tocadomorcego.tocaos.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AppGatewayHttpClientTest {
    @Test
    fun `requires https for remote app gateway origins`() {
        assertEquals(
            "https://api.toca.example:8443",
            AppGatewayEndpointPolicy.normalizeBaseUrl("https://api.toca.example:8443/"),
        )

        assertThrows(IllegalArgumentException::class.java) {
            AppGatewayEndpointPolicy.normalizeBaseUrl("http://api.toca.example")
        }
    }

    @Test
    fun `allows loopback http for local Android development only`() {
        assertEquals(
            "http://127.0.0.1:3000",
            AppGatewayEndpointPolicy.normalizeBaseUrl("http://127.0.0.1:3000"),
        )
        assertEquals(
            "http://localhost:3000",
            AppGatewayEndpointPolicy.normalizeBaseUrl("http://localhost:3000/"),
        )
    }

    @Test
    fun `rejects base urls with embedded path credentials query or fragment`() {
        listOf(
            "https://api.toca.example/api",
            "https://user:pass@api.toca.example",
            "https://api.toca.example?token=secret",
            "https://api.toca.example#fragment",
        ).forEach { value ->
            assertThrows(IllegalArgumentException::class.java) {
                AppGatewayEndpointPolicy.normalizeBaseUrl(value)
            }
        }
    }
}
