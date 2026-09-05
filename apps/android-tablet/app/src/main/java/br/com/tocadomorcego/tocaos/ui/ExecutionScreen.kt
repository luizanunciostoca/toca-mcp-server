package br.com.tocadomorcego.tocaos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.tocadomorcego.tocaos.domain.ActionEvent
import br.com.tocadomorcego.tocaos.domain.ActionState

@Composable
fun ExecutionScreen(events: List<ActionEvent>, onContinue: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(32.dp),
    ) {
        Text("Produção em andamento", fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Text(
            "O status final só muda para concluído após os gates aplicáveis.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(28.dp))

        Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(24.dp)) {
            Column(modifier = Modifier.fillMaxWidth().padding(24.dp)) {
                events.forEach { event ->
                    Row(modifier = Modifier.padding(vertical = 10.dp)) {
                        Text(statusGlyph(event.state), color = statusColor(event.state), fontSize = 20.sp)
                        Spacer(Modifier.padding(8.dp))
                        Column {
                            Text(event.label, fontWeight = if (event.state == ActionState.RUNNING) FontWeight.Bold else FontWeight.Normal)
                            Text(event.state.name, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        Spacer(Modifier.weight(1f))
        Button(modifier = Modifier.fillMaxWidth().height(58.dp), onClick = onContinue) {
            Text("Abrir revisão", fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun statusColor(state: ActionState): Color = when (state) {
    ActionState.COMPLETED -> MaterialTheme.colorScheme.primary
    ActionState.RUNNING -> MaterialTheme.colorScheme.secondary
    ActionState.BLOCKED, ActionState.FAILED, ActionState.UNCERTAIN -> Color(0xFFFF6B6B)
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

private fun statusGlyph(state: ActionState): String = when (state) {
    ActionState.COMPLETED -> "✓"
    ActionState.RUNNING -> "●"
    ActionState.BLOCKED -> "!"
    ActionState.UNCERTAIN -> "?"
    ActionState.FAILED -> "×"
    else -> "○"
}
