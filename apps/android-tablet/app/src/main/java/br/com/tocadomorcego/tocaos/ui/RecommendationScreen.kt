package br.com.tocadomorcego.tocaos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.tocadomorcego.tocaos.domain.ActionType
import br.com.tocadomorcego.tocaos.domain.VideoCreationRoute
import br.com.tocadomorcego.tocaos.domain.displayTitle

@Composable
fun RecommendationScreen(
    actionType: ActionType,
    operation: String,
    objective: String,
    videoRoute: VideoCreationRoute,
    onBack: () -> Unit,
    onCreate: () -> Unit,
) {
    val isVideo = actionType == ActionType.CREATE_VIDEO
    Column(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(32.dp),
    ) {
        Text("← Ajustar pedido", modifier = Modifier.clickable(onClick = onBack), color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(20.dp))
        Text("Melhor rota recomendada", fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Text("$operation • $objective", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(28.dp))

        RecommendationCard(
            rank = "01",
            title = if (isVideo) videoRoute.displayTitle() else "Sequência de 3 Stories",
            body = if (isVideo) {
                "Rota de vídeo governada com story arc, source binding, seleção de takes e QA antes de qualquer entrega."
            } else {
                "Desejo → prova social → CTA. Melhor equilíbrio entre impacto, contexto e conversão."
            },
            selected = true,
        )
        Spacer(Modifier.height(14.dp))
        RecommendationCard(
            "02",
            if (isVideo) "Director's Cut / Recut alternativo" else "Feed Experiência",
            if (isVideo) "Fallback de reuso/recut antes de gerar material novo." else "Peça foto-first para reforçar prova social e desejo.",
            false,
        )
        Spacer(Modifier.height(14.dp))
        RecommendationCard(
            "03",
            if (isVideo) "Editorial motion complementar" else "Story complementar",
            if (isVideo) "Motion design para impacto sem inventar cena nova." else "Apoio editorial com outra função narrativa e foto menos saturada.",
            false,
        )

        Spacer(Modifier.height(28.dp))
        Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(20.dp)) {
            Column(modifier = Modifier.fillMaxWidth().padding(20.dp)) {
                Text("O sistema fará automaticamente", fontWeight = FontWeight.Bold)
                Text("• resolver fatos da edição", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("• aplicar story arc e funções narrativas", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("• ranquear takes reais com anti-repetição", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("• preservar source binding e Creative Truth", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("• produzir master, approval, cover e QA", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        Spacer(Modifier.weight(1f))
        Button(modifier = Modifier.fillMaxWidth().height(58.dp), onClick = onCreate) {
            Text("Criar opção recomendada", fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun RecommendationCard(rank: String, title: String, body: String, selected: Boolean) {
    Surface(
        color = if (selected) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(20.dp),
        tonalElevation = if (selected) 2.dp else 0.dp,
    ) {
        Row(modifier = Modifier.fillMaxWidth().padding(20.dp)) {
            Text(rank, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Spacer(Modifier.padding(8.dp))
            Column {
                Text(title, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                Text(body, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
