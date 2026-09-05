package br.com.tocadomorcego.tocaos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import br.com.tocadomorcego.tocaos.data.AppGatewayHttpClient
import br.com.tocadomorcego.tocaos.data.FakeActionGateway
import br.com.tocadomorcego.tocaos.data.MemoryAppSessionTokenStore
import br.com.tocadomorcego.tocaos.data.RemoteActionGateway
import br.com.tocadomorcego.tocaos.ui.AppSessionBootstrapScreen
import br.com.tocadomorcego.tocaos.ui.GatewayConfigurationScreen
import br.com.tocadomorcego.tocaos.ui.TocaOsApp
import br.com.tocadomorcego.tocaos.ui.theme.TocaTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TocaTheme {
                val baseUrl = BuildConfig.APP_GATEWAY_BASE_URL.trim()
                var demoEnabled by remember { mutableStateOf(false) }
                val sessionStore = remember { MemoryAppSessionTokenStore() }
                var sessionBound by remember { mutableStateOf(sessionStore.hasSession()) }

                when {
                    baseUrl.isBlank() && !demoEnabled -> GatewayConfigurationScreen(
                        debugDemoAvailable = BuildConfig.DEBUG,
                        onOpenDemo = { demoEnabled = true },
                    )

                    demoEnabled -> TocaOsApp(gateway = FakeActionGateway())

                    !sessionBound -> AppSessionBootstrapScreen(
                        onSubmit = { token ->
                            sessionStore.bind(token)
                            sessionBound = true
                        },
                    )

                    else -> {
                        val gateway = remember(baseUrl, sessionBound) {
                            RemoteActionGateway(
                                client = AppGatewayHttpClient(baseUrl, sessionStore),
                                sessionStore = sessionStore,
                            )
                        }
                        TocaOsApp(
                            gateway = gateway,
                            onAuthRequired = {
                                sessionStore.clear()
                                sessionBound = false
                            },
                        )
                    }
                }
            }
        }
    }
}
