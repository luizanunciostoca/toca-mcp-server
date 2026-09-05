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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun ResultScreen(
    correlationId: String,
    title: String,
    message: String,
    status: String,
    onHome: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))
        Text("✓", color = MaterialTheme.colorScheme.primary, fontSize = 56.sp)
        Spacer(Modifier.height(12.dp))
        Text(title, fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Text(
            message,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(28.dp))
        Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(22.dp)) {
            Column(modifier = Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Status: $status", fontWeight = FontWeight.Bold)
                Text("Correlation ID: $correlationId", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.weight(1f))
        Button(modifier = Modifier.fillMaxWidth().height(58.dp), onClick = onHome) {
            Text("Voltar ao início", fontWeight = FontWeight.Bold)
        }
    }
}
