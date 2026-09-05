package br.com.tocadomorcego.tocaos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import br.com.tocadomorcego.tocaos.data.FakeActionGateway
import br.com.tocadomorcego.tocaos.ui.TocaOsApp
import br.com.tocadomorcego.tocaos.ui.theme.TocaTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TocaTheme {
                TocaOsApp(gateway = FakeActionGateway())
            }
        }
    }
}
