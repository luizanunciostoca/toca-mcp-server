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
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.tocadomorcego.tocaos.domain.ApprovalPreview

@Composable
fun ReviewScreen(
    objective: String,
    approvalPreview: ApprovalPreview?,
    onRequestChanges: () -> Unit,
    onApprove: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(32.dp),
    ) {
        Text("Revisão", fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Text(objective, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(28.dp))

        Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(24.dp)) {
            Column(modifier = Modifier.fillMaxWidth().padding(24.dp)) {
                Text("3 Stories preparados", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(14.dp))
                Text("Story 1 • Desejo • QA PASS")
                Text("Story 2 • Prova social • QA PASS")
                Text("Story 3 • CTA • QA PASS")
                Spacer(Modifier.height(18.dp))
                Text(
                    "Aprovar esta revisão não autoriza automaticamente publicação ou gasto.",
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        approvalPreview?.let { approval ->
            Spacer(Modifier.height(18.dp))
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(20.dp)) {
                Column(modifier = Modifier.fillMaxWidth().padding(20.dp)) {
                    Text(
                        "Aprovação descriptor-bound",
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(10.dp))
                    Text("Approval ID: ${approval.approvalId}")
                    Text("Capability: ${approval.capabilityId}")
                    Text("Route: ${approval.routeId}")
                    Text("Conta alvo: ${approval.targetAccount}")
                    Text("Status: ${approval.status}")
                    Text("Expira em: ${approval.expiresAt}")
                    approval.financialCeiling?.let { ceiling ->
                        Text("Teto financeiro: $ceiling")
                    }
                    Spacer(Modifier.height(10.dp))
                    Text("Descriptor SHA-256", fontWeight = FontWeight.Bold)
                    Text(
                        approval.descriptorSha256,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "O app exibe este vínculo; a autorização efetiva continua pertencendo ao Core.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Spacer(Modifier.weight(1f))
        Row(modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(
                modifier = Modifier.weight(1f).height(58.dp),
                onClick = onRequestChanges,
            ) {
                Text("Solicitar alterações")
            }
            Spacer(Modifier.padding(8.dp))
            Button(
                modifier = Modifier.weight(1f).height(58.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                onClick = onApprove,
            ) {
                Text("Aprovar produção", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold)
            }
        }
    }
}
