package br.com.tocadomorcego.tocaos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.tocadomorcego.tocaos.domain.ActionAvailability
import br.com.tocadomorcego.tocaos.domain.ActionCard
import br.com.tocadomorcego.tocaos.domain.ActionType

@Composable
fun ActionLauncherScreen(cards: List<ActionCard>, onCreateContent: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(28.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text("TOCA OS", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                Text("O que você quer fazer?", fontSize = 32.sp, fontWeight = FontWeight.Bold)
                Text(
                    "Escolha uma ação ou descreva seu objetivo. O sistema resolve a rota.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(24.dp),
            ) {
                Text("Falar com o TOCA", modifier = Modifier.padding(horizontal = 22.dp, vertical = 14.dp))
            }
        }

        Spacer(Modifier.height(24.dp))
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(22.dp),
        ) {
            Text(
                "Ex.: Quero vender mais ingressos para a The Party de sábado",
                modifier = Modifier.padding(22.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(22.dp))

        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 250.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(cards, key = { it.type.name }) { card ->
                ActionLauncherCard(
                    card = card,
                    onClick = if (card.type == ActionType.CREATE_CONTENT) onCreateContent else ({ }),
                )
            }
        }
    }
}

@Composable
private fun ActionLauncherCard(card: ActionCard, onClick: () -> Unit) {
    val enabled = card.availability == ActionAvailability.AVAILABLE ||
        card.availability == ActionAvailability.LIMITED
    val accent = when (card.availability) {
        ActionAvailability.AVAILABLE -> MaterialTheme.colorScheme.primary
        ActionAvailability.LIMITED -> MaterialTheme.colorScheme.secondary
        ActionAvailability.UNAVAILABLE -> Color(0xFF6F6F6F)
        ActionAvailability.BLOCKED -> Color(0xFFB94A48)
    }

    Card(
        modifier = Modifier.fillMaxWidth().height(164.dp).clickable(enabled = enabled, onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(22.dp),
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.width(8.dp).height(8.dp).background(accent, RoundedCornerShape(4.dp)),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    card.availability.name.replace('_', ' '),
                    color = accent,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                )
            }
            Spacer(Modifier.height(14.dp))
            Text(card.title, fontSize = 21.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(card.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (card.approvalHint) {
                Spacer(Modifier.weight(1f))
                Text("Pode exigir aprovação", color = accent, fontSize = 12.sp)
            }
        }
    }
}
