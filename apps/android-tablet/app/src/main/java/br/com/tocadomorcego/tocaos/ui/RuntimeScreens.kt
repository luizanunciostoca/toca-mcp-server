package br.com.tocadomorcego.tocaos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

enum class AppRuntimeState { BOOTSTRAPPING, AUTH_REQUIRED, READY, LOADING, ERROR }

@Composable
fun AppSessionBootstrapScreen(
    onSubmit: (String) -> Unit,
) {
    var token by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(32.dp),
    ) {
        Text("TOCA OS", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        Text("Conectar sessão", fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Text(
            "Informe um token de sessão do TOCA OS. Ele permanece somente na memória deste app e não deve ser um token de Meta, Google ou outro provider.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            label = { Text("Token de sessão TOCA OS") },
            shape = RoundedCornerShape(18.dp),
        )
        Spacer(Modifier.weight(1f))
        Button(
            modifier = Modifier.fillMaxWidth().height(58.dp),
            enabled = token.isNotBlank(),
            onClick = {
                onSubmit(token)
                token = ""
            },
        ) {
            Text("Conectar", fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun RuntimeStatusScreen(
    title: String,
    message: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))
        Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(24.dp)) {
            Column(modifier = Modifier.padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(title, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                Text(
                    message,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.weight(1f))
        if (actionLabel != null && onAction != null) {
            Button(modifier = Modifier.fillMaxWidth().height(58.dp), onClick = onAction) {
                Text(actionLabel, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun GatewayConfigurationScreen(
    debugDemoAvailable: Boolean,
    onOpenDemo: () -> Unit,
) {
    RuntimeStatusScreen(
        title = "App Gateway não configurado",
        message = if (debugDemoAvailable) {
            "Defina tocaAppGatewayBaseUrl para usar o servidor real. Este build de desenvolvimento também permite abrir explicitamente o modo demo."
        } else {
            "Este build exige um App Gateway HTTPS configurado. Nenhuma capability será simulada em modo release."
        },
        actionLabel = if (debugDemoAvailable) "Abrir modo demo" else null,
        onAction = if (debugDemoAvailable) onOpenDemo else null,
    )
}
