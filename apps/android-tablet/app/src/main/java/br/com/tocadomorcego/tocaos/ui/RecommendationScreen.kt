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

@Composable
fun RecommendationScreen(
    operation: String,
    objective: String,
    onBack: () -> Unit,
    onCreate: () -> Unit,
) {
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
            title = "Sequência de 3 Stories",
            body = "Desejo → prova social → CTA. Melhor equilíbrio entre impacto, contexto e conversão.",
            selected = true,
        )
        Spacer(Modifier.height(14.dp))
        RecommendationCard("02", "Feed Experiência", "Peça foto-first para reforçar prova social e desejo.", false)
        Spacer(Modifier.height(14.dp))
        RecommendationCard("03", "Story complementar", "Apoio editorial com outra função narrativa e foto menos saturada.", false)

        Spacer(Modifier.height(28.dp))
        Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(20.dp)) {
            Column(modifier = Modifier.fillMaxWidth().padding(20.dp)) {
                Text("O sistema fará automaticamente", fontWeight = FontWeight.Bold)
                Text("• resolver fatos da edição", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("• analisar e ranquear fotos reais", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("• aplicar Visual Memory / anti-repetição", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("• produzir e executar QA", color = MaterialTheme.colorScheme.onSurfaceVariant)
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
