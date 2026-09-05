package br.com.tocadomorcego.tocaos.domain

import org.junit.Assert.assertEquals
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
        assertEquals("PUBLISH_SCHEDULE", ActionType.PUBLISH_SCHEDULE.name)
    }
}
