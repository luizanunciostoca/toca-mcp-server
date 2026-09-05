package br.com.tocadomorcego.tocaos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.tocadomorcego.tocaos.domain.ActionType
import br.com.tocadomorcego.tocaos.domain.VideoCreationOption
import br.com.tocadomorcego.tocaos.domain.VideoCreationRoute

@Composable
fun CreateContentWizardScreen(
    actionType: ActionType,
    initialObjective: String,
    initialOperation: String,
    initialVideoRoute: VideoCreationRoute,
    videoOptions: List<VideoCreationOption>,
    onBack: () -> Unit,
    onContinue: (operation: String, objective: String, videoRoute: VideoCreationRoute) -> Unit,
) {
    var objective by remember(initialObjective) { mutableStateOf(initialObjective) }
    var operation by remember(initialOperation) { mutableStateOf(initialOperation) }
    var videoRoute by remember(initialVideoRoute) { mutableStateOf(initialVideoRoute) }
    val operations = listOf("THE_PARTY", "SUNSET", "TOCA", "EVENTO_ESPECIAL")
    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(32.dp),
    ) {
        Column(modifier = Modifier.weight(1f).verticalScroll(scrollState)) {
            Text("← Voltar", modifier = Modifier.clickable(onClick = onBack), color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(22.dp))
            Text(
                if (actionType == ActionType.CREATE_VIDEO) "Criar vídeo" else "Criar conteúdo",
                fontSize = 34.sp,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "Informe o objetivo. O TOCA OS escolhe mídia, rota, gates e entrega adequada.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(32.dp))

            Text("1. Qual produto ou evento?", fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                operations.forEach { item ->
                    Surface(
                        modifier = Modifier.clickable { operation = item },
                        color = if (operation == item) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                        contentColor = if (operation == item) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                        shape = RoundedCornerShape(18.dp),
                    ) {
                        Text(item.replace('_', ' '), modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp))
                    }
                }
            }

            Spacer(Modifier.height(30.dp))
            Text("2. Qual é o objetivo?", fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = objective,
                onValueChange = { objective = it },
                modifier = Modifier.fillMaxWidth(),
                minLines = 4,
                placeholder = { Text("Ex.: vender ingressos, gerar desejo, divulgar artista...") },
                shape = RoundedCornerShape(18.dp),
            )

            if (actionType == ActionType.CREATE_VIDEO) {
                Spacer(Modifier.height(30.dp))
                Text("3. Escolha a rota de criação de vídeo", fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                if (videoOptions.isEmpty()) {
                    Text(
                        "As rotas de vídeo não foram disponibilizadas pelo App Gateway.",
                        color = MaterialTheme.colorScheme.error,
                    )
                } else {
                    videoOptions.forEach { option ->
                        VideoRouteOptionCard(
                            title = option.title,
                            description = option.description,
                            label = option.availabilityLabel,
                            selected = option.route == videoRoute,
                            onClick = { videoRoute = option.route },
                        )
                        Spacer(Modifier.height(10.dp))
                    }
                }
            }

            Spacer(Modifier.height(26.dp))
            Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(20.dp)) {
                Column(modifier = Modifier.fillMaxWidth().padding(20.dp)) {
                    Text("Modo automático", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                    Text(
                        "O sistema analisará fatos vigentes, banco de mídia, histórico de uso, source binding e QA antes de recomendar o que criar.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        Button(
            modifier = Modifier.fillMaxWidth().height(58.dp),
            enabled = objective.isNotBlank() &&
                (actionType != ActionType.CREATE_VIDEO || videoOptions.any { it.route == videoRoute }),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
            onClick = { onContinue(operation, objective.trim(), videoRoute) },
        ) {
            Text("Analisar e recomendar", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun VideoRouteOptionCard(
    title: String,
    description: String,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        color = if (selected) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(18.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(6.dp))
            Text(label, color = MaterialTheme.colorScheme.primary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
    }
}
