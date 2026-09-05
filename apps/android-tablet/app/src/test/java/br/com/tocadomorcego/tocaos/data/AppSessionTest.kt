package br.com.tocadomorcego.tocaos.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AppSessionTest {
    @Test
    fun `session token is memory only and fails closed before binding`() {
        val store = MemoryAppSessionTokenStore()

        assertFalse(store.hasSession())
        assertThrows(AppSessionRequiredException::class.java) {
            store.appSessionToken()
        }

        store.bind("  toca-session-token  ")
        assertTrue(store.hasSession())
        assertEquals("toca-session-token", store.appSessionToken())

        store.clear()
        assertFalse(store.hasSession())
        assertThrows(AppSessionRequiredException::class.java) {
            store.appSessionToken()
        }
    }

    @Test
    fun `session store rejects empty or header injection values`() {
        val store = MemoryAppSessionTokenStore()
        assertThrows(IllegalArgumentException::class.java) { store.bind("   ") }
        assertThrows(IllegalArgumentException::class.java) { store.bind("token\r\nInjected: yes") }
    }
}
