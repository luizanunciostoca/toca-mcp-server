package br.com.tocadomorcego.tocaos.data

import br.com.tocadomorcego.tocaos.domain.ActionMode
import br.com.tocadomorcego.tocaos.domain.ActionState
import br.com.tocadomorcego.tocaos.domain.ActionType
import br.com.tocadomorcego.tocaos.domain.TocaActionRequest
import br.com.tocadomorcego.tocaos.domain.VideoCreationRoute
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
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

    @Test
    fun `maps mocked capability and video option responses`() {
        val routes = VideoCreationRoute.entries.joinToString(",") { route ->
            val restricted = route == VideoCreationRoute.SYNTHETIC_TEXT_TO_VIDEO_RESTRICTED
            """{"route":"${route.name}","manual_order":1,"title":"${route.name}","description":"route","availability":"${if (restricted) "RESTRITO" else "DISPONIVEL"}","source_binding":true,"generative":false,"restricted":$restricted,"best_use":"test","drift_risk":"BAIXO","requires_coverage_evidence":false}"""
        }
        val client = AppGatewayHttpClient { request ->
            when (request.path) {
                "/api/v1/capabilities" -> """{"actions":[{"action_type":"CREATE_VIDEO","title":"Criar vídeo","description":"Vídeo governado","default_mode":"AUTO","availability":"AVAILABLE","approval_hint":false,"reasons":[]}]}"""
                "/api/v1/video-options" -> """{"video_options":[$routes]}"""
                else -> error("Unexpected request: ${request.path}")
            }
        }

        val cards = client.fetchActionCards()
        assertEquals(1, cards.size)
        assertEquals(ActionType.CREATE_VIDEO, cards.single().type)

        val videoOptions = client.fetchVideoOptions()
        assertEquals(10, videoOptions.size)
        assertTrue(videoOptions.last().restricted)
        assertEquals(
            VideoCreationRoute.SYNTHETIC_TEXT_TO_VIDEO_RESTRICTED,
            videoOptions.last().route,
        )
    }

    @Test
    fun `maps prepared action from mocked App Gateway response`() {
        val client = AppGatewayHttpClient { request ->
            assertEquals("/api/v1/actions", request.path)
            assertEquals("POST", request.method)
            assertTrue(request.jsonBody.orEmpty().contains("REAL_FOOTAGE_FILM"))
            """{"client_request_id":"client-1","action":{"action_id":"ACT-1","correlation_id":"CORR-1","state":"READY","availability":"AVAILABLE","approval_hint":false,"reasons":[],"request":{"action_type":"CREATE_VIDEO","operation":"THE_PARTY","objective":"Criar Reel","mode":"AUTO","video_route":"REAL_FOOTAGE_FILM","inputs":{"video_route":"REAL_FOOTAGE_FILM"}}}}"""
        }

        val request = TocaActionRequest(
            actionType = ActionType.CREATE_VIDEO,
            operation = "THE_PARTY",
            objective = "Criar Reel",
            mode = ActionMode.AUTO,
            inputs = mapOf("video_route" to VideoCreationRoute.REAL_FOOTAGE_FILM.name),
        )
        val action = client.prepare(request)

        assertEquals("ACT-1", action.actionId)
        assertEquals("CORR-1", action.correlationId)
        assertEquals(ActionState.READY, action.state)
    }
}
