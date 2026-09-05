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
import br.com.tocadomorcego.tocaos.domain.VideoCreationRoute

private enum class AppScreen { HOME, WIZARD, RECOMMENDATION, EXECUTION, REVIEW, RESULT }

@Composable
fun TocaOsApp(gateway: ActionGateway) {
    var screen by remember { mutableStateOf(AppScreen.HOME) }
    var actionType by remember { mutableStateOf(ActionType.CREATE_CONTENT) }
    var objective by remember { mutableStateOf("") }
    var operation by remember { mutableStateOf("THE_PARTY") }
    var videoRoute by remember { mutableStateOf(VideoCreationRoute.REAL_FOOTAGE_FILM) }
    var action by remember { mutableStateOf<TocaAction?>(null) }

    when (screen) {
        AppScreen.HOME -> ActionLauncherScreen(
            cards = gateway.actionCards(),
            onStartAction = { selected ->
                actionType = selected
                screen = AppScreen.WIZARD
            },
        )

        AppScreen.WIZARD -> CreateContentWizardScreen(
            actionType = actionType,
            initialObjective = objective,
            initialOperation = operation,
            initialVideoRoute = videoRoute,
            onBack = { screen = AppScreen.HOME },
            onContinue = { chosenOperation, chosenObjective, chosenVideoRoute ->
                operation = chosenOperation
                objective = chosenObjective
                videoRoute = chosenVideoRoute
                action = gateway.prepare(
                    TocaActionRequest(
                        actionType = actionType,
                        operation = chosenOperation,
                        objective = chosenObjective,
                        mode = ActionMode.AUTO,
                        inputs = if (actionType == ActionType.CREATE_VIDEO) {
                            mapOf("video_route" to chosenVideoRoute.name)
                        } else {
                            emptyMap()
                        },
                    ),
                )
                screen = AppScreen.RECOMMENDATION
            },
        )

        AppScreen.RECOMMENDATION -> RecommendationScreen(
            actionType = actionType,
            operation = operation,
            objective = objective,
            videoRoute = videoRoute,
            onBack = { screen = AppScreen.WIZARD },
            onCreate = { screen = AppScreen.EXECUTION },
        )

        AppScreen.EXECUTION -> ExecutionScreen(
            events = action?.let(gateway::executionPreview).orEmpty(),
            onContinue = { screen = AppScreen.REVIEW },
        )

        AppScreen.REVIEW -> ReviewScreen(
            objective = objective,
            approvalPreview = action?.approvalPreview,
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
