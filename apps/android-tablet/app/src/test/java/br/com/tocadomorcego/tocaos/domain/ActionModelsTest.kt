package br.com.tocadomorcego.tocaos.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ActionModelsTest {
    @Test
    fun `uncertain remains distinct from completed`() {
        assertEquals("UNCERTAIN", ActionState.UNCERTAIN.name)
        assertEquals("COMPLETED", ActionState.COMPLETED.name)
    }

    @Test
    fun `client action types match gateway wire names`() {
        assertEquals("CREATE_CONTENT", ActionType.CREATE_CONTENT.name)
        assertEquals("CREATE_VIDEO", ActionType.CREATE_VIDEO.name)
        assertEquals("PUBLISH_SCHEDULE", ActionType.PUBLISH_SCHEDULE.name)
    }

    @Test
    fun `video creation options mirror the visual manual routes`() {
        assertEquals(10, VIDEO_CREATION_OPTIONS.size)
        assertEquals(VideoCreationRoute.REAL_FOOTAGE_FILM, VIDEO_CREATION_OPTIONS.first().route)
        assertEquals(
            VideoCreationRoute.SYNTHETIC_TEXT_TO_VIDEO_RESTRICTED,
            VIDEO_CREATION_OPTIONS.last().route,
        )
        assertTrue(VIDEO_CREATION_OPTIONS.last().restricted)
    }

    @Test
    fun `approval preview preserves descriptor binding from server`() {
        val descriptor = "a".repeat(64)
        val preview = ApprovalPreview(
            approvalId = "APR-001",
            capabilityId = "instagram.publication.publish",
            routeId = "R20",
            targetAccount = "instagram:toca",
            descriptorSha256 = descriptor,
            expiresAt = "2026-09-05T03:00:00-03:00",
            status = "REQUESTED",
        )

        assertEquals(descriptor, preview.descriptorSha256)
        assertEquals("R20", preview.routeId)
        assertEquals("instagram:toca", preview.targetAccount)
    }
}
