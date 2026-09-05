package br.com.tocadomorcego.tocaos.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import br.com.tocadomorcego.tocaos.data.ActionGateway
import br.com.tocadomorcego.tocaos.data.AppGatewayHttpException
import br.com.tocadomorcego.tocaos.data.AppSessionRequiredException
import br.com.tocadomorcego.tocaos.data.GatewayExecutionMode
import br.com.tocadomorcego.tocaos.domain.ActionCard
import br.com.tocadomorcego.tocaos.domain.ActionMode
import br.com.tocadomorcego.tocaos.domain.ActionType
import br.com.tocadomorcego.tocaos.domain.TocaAction
import br.com.tocadomorcego.tocaos.domain.TocaActionRequest
import br.com.tocadomorcego.tocaos.domain.VideoCreationOption
import br.com.tocadomorcego.tocaos.domain.VideoCreationRoute
import kotlinx.coroutines.launch

private enum class AppScreen { HOME, WIZARD, RECOMMENDATION, EXECUTION, REVIEW, RESULT }

@Composable
fun TocaOsApp(
    gateway: ActionGateway,
    onAuthRequired: () -> Unit = {},
) {
    var screen by remember { mutableStateOf(AppScreen.HOME) }
    var actionType by remember { mutableStateOf(ActionType.CREATE_CONTENT) }
    var objective by remember { mutableStateOf("") }
    var operation by remember { mutableStateOf("THE_PARTY") }
    var videoRoute by remember { mutableStateOf(VideoCreationRoute.REAL_FOOTAGE_FILM) }
    var action by remember { mutableStateOf<TocaAction?>(null) }
    var cards by remember(gateway) { mutableStateOf<List<ActionCard>>(emptyList()) }
    var videoOptions by remember(gateway) { mutableStateOf<List<VideoCreationOption>>(emptyList()) }
    var runtimeState by remember(gateway) { mutableStateOf(AppRuntimeState.BOOTSTRAPPING) }
    var runtimeError by remember(gateway) { mutableStateOf<String?>(null) }
    var reloadNonce by remember(gateway) { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(gateway, reloadNonce) {
        runtimeState = AppRuntimeState.BOOTSTRAPPING
        runtimeError = null
        try {
            cards = gateway.actionCards()
            videoOptions = gateway.videoOptions()
            runtimeState = AppRuntimeState.READY
        } catch (error: Throwable) {
            if (isAuthenticationFailure(error)) {
                runtimeState = AppRuntimeState.AUTH_REQUIRED
                onAuthRequired()
            } else {
                runtimeError = safeRuntimeError(error)
                runtimeState = AppRuntimeState.ERROR
            }
        }
    }

    when (runtimeState) {
        AppRuntimeState.BOOTSTRAPPING -> RuntimeStatusScreen(
            title = "Conectando ao TOCA OS",
            message = "Validando a sessão e carregando capabilities e rotas de criação.",
        )

        AppRuntimeState.AUTH_REQUIRED -> RuntimeStatusScreen(
            title = "Sessão necessária",
            message = "A sessão expirou ou não foi aceita. Conecte novamente para continuar.",
        )

        AppRuntimeState.LOADING -> RuntimeStatusScreen(
            title = "Preparando ação",
            message = "O App Gateway está validando seu pedido sem executar nenhum side effect externo.",
        )

        AppRuntimeState.ERROR -> RuntimeStatusScreen(
            title = "Não foi possível carregar o TOCA OS",
            message = runtimeError ?: "Falha de comunicação com o App Gateway.",
            actionLabel = "Tentar novamente",
            onAction = { reloadNonce += 1 },
        )

        AppRuntimeState.READY -> when (screen) {
            AppScreen.HOME -> ActionLauncherScreen(
                cards = cards,
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
                videoOptions = videoOptions,
                onBack = { screen = AppScreen.HOME },
                onContinue = { chosenOperation, chosenObjective, chosenVideoRoute ->
                    operation = chosenOperation
                    objective = chosenObjective
                    videoRoute = chosenVideoRoute
                    runtimeState = AppRuntimeState.LOADING
                    scope.launch {
                        try {
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
                            runtimeState = AppRuntimeState.READY
                            screen = AppScreen.RECOMMENDATION
                        } catch (error: Throwable) {
                            if (isAuthenticationFailure(error)) {
                                runtimeState = AppRuntimeState.AUTH_REQUIRED
                                onAuthRequired()
                            } else {
                                runtimeError = safeRuntimeError(error)
                                runtimeState = AppRuntimeState.ERROR
                            }
                        }
                    }
                },
            )

            AppScreen.RECOMMENDATION -> RecommendationScreen(
                actionType = actionType,
                operation = operation,
                objective = objective,
                videoRoute = videoRoute,
                onBack = { screen = AppScreen.WIZARD },
                onCreate = {
                    screen = if (gateway.executionMode == GatewayExecutionMode.DEMO) {
                        AppScreen.EXECUTION
                    } else {
                        AppScreen.RESULT
                    }
                },
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
                title = if (gateway.executionMode == GatewayExecutionMode.PREPARE_ONLY) {
                    "Ação preparada"
                } else {
                    "Produção demo concluída"
                },
                message = if (gateway.executionMode == GatewayExecutionMode.PREPARE_ONLY) {
                    "O pedido foi validado e preparado. Esta versão do App Gateway ainda não executa publicação, geração ou outro side effect externo."
                } else {
                    "A simulação local terminou. Ela não representa execução de provider."
                },
                status = action?.state?.name ?: "READY",
                onHome = {
                    objective = ""
                    action = null
                    screen = AppScreen.HOME
                },
            )
        }
    }
}

private fun isAuthenticationFailure(error: Throwable): Boolean =
    error is AppSessionRequiredException ||
        (error is AppGatewayHttpException && error.statusCode == 401)

private fun safeRuntimeError(error: Throwable): String = when (error) {
    is AppGatewayHttpException -> error.safeCode
    is IllegalArgumentException -> error.message ?: "INVALID_APP_CONFIGURATION"
    else -> "APP_GATEWAY_UNAVAILABLE"
}
