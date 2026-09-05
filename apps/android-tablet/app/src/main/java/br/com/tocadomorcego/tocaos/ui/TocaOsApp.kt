package br.com.tocadomorcego.tocaos.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import br.com.tocadomorcego.tocaos.data.ActionGateway
import br.com.tocadomorcego.tocaos.domain.ActionMode
import br.com.tocadomorcego.tocaos.domain.ActionType
import br.com.tocadomorcego.tocaos.domain.TocaAction
import br.com.tocadomorcego.tocaos.domain.TocaActionRequest

private enum class AppScreen { HOME, WIZARD, RECOMMENDATION, EXECUTION, REVIEW, RESULT }

@Composable
fun TocaOsApp(gateway: ActionGateway) {
    var screen by remember { mutableStateOf(AppScreen.HOME) }
    var objective by remember { mutableStateOf("") }
    var operation by remember { mutableStateOf("THE_PARTY") }
    var action by remember { mutableStateOf<TocaAction?>(null) }

    when (screen) {
        AppScreen.HOME -> ActionLauncherScreen(
            cards = gateway.actionCards(),
            onCreateContent = { screen = AppScreen.WIZARD },
        )

        AppScreen.WIZARD -> CreateContentWizardScreen(
            initialObjective = objective,
            initialOperation = operation,
            onBack = { screen = AppScreen.HOME },
            onContinue = { chosenOperation, chosenObjective ->
                operation = chosenOperation
                objective = chosenObjective
                action = gateway.prepare(
                    TocaActionRequest(
                        actionType = ActionType.CREATE_CONTENT,
                        operation = chosenOperation,
                        objective = chosenObjective,
                        mode = ActionMode.AUTO,
                    ),
                )
                screen = AppScreen.RECOMMENDATION
            },
        )

        AppScreen.RECOMMENDATION -> RecommendationScreen(
            operation = operation,
            objective = objective,
            onBack = { screen = AppScreen.WIZARD },
            onCreate = { screen = AppScreen.EXECUTION },
        )

        AppScreen.EXECUTION -> ExecutionScreen(
            events = action?.let(gateway::executionPreview).orEmpty(),
            onContinue = { screen = AppScreen.REVIEW },
        )

        AppScreen.REVIEW -> ReviewScreen(
            objective = objective,
            onRequestChanges = { screen = AppScreen.WIZARD },
            onApprove = { screen = AppScreen.RESULT },
        )

        AppScreen.RESULT -> ResultScreen(
            correlationId = action?.correlationId.orEmpty(),
            onHome = {
                objective = ""
                action = null
                screen = AppScreen.HOME
            },
        )
    }
}
