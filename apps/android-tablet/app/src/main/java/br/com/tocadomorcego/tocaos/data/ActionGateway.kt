package br.com.tocadomorcego.tocaos.data

import br.com.tocadomorcego.tocaos.domain.ActionAvailability
import br.com.tocadomorcego.tocaos.domain.ActionCard
import br.com.tocadomorcego.tocaos.domain.ActionEvent
import br.com.tocadomorcego.tocaos.domain.ActionMode
import br.com.tocadomorcego.tocaos.domain.ActionState
import br.com.tocadomorcego.tocaos.domain.ActionType
import br.com.tocadomorcego.tocaos.domain.TocaAction
import br.com.tocadomorcego.tocaos.domain.TocaActionRequest
import br.com.tocadomorcego.tocaos.domain.VIDEO_CREATION_OPTIONS
import br.com.tocadomorcego.tocaos.domain.VideoCreationOption
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

enum class GatewayExecutionMode { DEMO, PREPARE_ONLY }

interface ActionGateway {
    val executionMode: GatewayExecutionMode

    suspend fun actionCards(): List<ActionCard>
    suspend fun videoOptions(): List<VideoCreationOption>
    suspend fun prepare(request: TocaActionRequest): TocaAction
    fun executionPreview(action: TocaAction): List<ActionEvent>
}

class RemoteActionGateway(
    private val client: AppGatewayHttpClient,
    private val sessionStore: MutableAppSessionTokenStore,
) : ActionGateway {
    override val executionMode = GatewayExecutionMode.PREPARE_ONLY

    override suspend fun actionCards(): List<ActionCard> = ioRequest { client.fetchActionCards() }

    override suspend fun videoOptions(): List<VideoCreationOption> = ioRequest { client.fetchVideoOptions() }

    override suspend fun prepare(request: TocaActionRequest): TocaAction = ioRequest { client.prepare(request) }

    override fun executionPreview(action: TocaAction): List<ActionEvent> = listOf(
        ActionEvent(1, "Ação preparada no TOCA App Gateway", ActionState.READY),
    )

    private suspend fun <T> ioRequest(block: () -> T): T = try {
        withContext(Dispatchers.IO) { block() }
    } catch (error: AppGatewayHttpException) {
        if (error.statusCode == 401) {
            sessionStore.clear()
            throw AppSessionRequiredException("APP_SESSION_EXPIRED")
        }
        throw error
    }
}

/**
 * Explicit debug/demo gateway. It never contacts providers and must never be interpreted as
 * capability truth or production execution evidence.
 */
class FakeActionGateway : ActionGateway {
    override val executionMode = GatewayExecutionMode.DEMO

    override suspend fun actionCards(): List<ActionCard> = listOf(
        ActionCard(
            type = ActionType.CREATE_CONTENT,
            title = "Criar conteúdo",
            description = "Story, Feed, Carrossel, Reels e peças de campanha.",
            availability = ActionAvailability.AVAILABLE,
            defaultMode = ActionMode.AUTO,
        ),
        ActionCard(
            type = ActionType.CREATE_VIDEO,
            title = "Criar vídeo",
            description = "Footage real, photo motion, source-bound, recut e motion editorial.",
            availability = ActionAvailability.AVAILABLE,
            defaultMode = ActionMode.AUTO,
        ),
        ActionCard(
            type = ActionType.PLAN_CONTENT,
            title = "Planejar conteúdo",
            description = "Calendário, campanha e sequência editorial.",
            availability = ActionAvailability.AVAILABLE,
            defaultMode = ActionMode.AUTO,
        ),
        ActionCard(
            type = ActionType.PUBLISH_SCHEDULE,
            title = "Publicar / Agendar",
            description = "Publicação governada e scheduling.",
            availability = ActionAvailability.LIMITED,
            defaultMode = ActionMode.GUIDED,
            approvalHint = true,
            reason = "Disponibilidade real será resolvida pelo servidor.",
        ),
        ActionCard(
            type = ActionType.MEDIA_LIBRARY,
            title = "Fotos e vídeos",
            description = "Buscar, selecionar e acompanhar ativos.",
            availability = ActionAvailability.AVAILABLE,
            defaultMode = ActionMode.AUTO,
        ),
        ActionCard(
            type = ActionType.META_ADS,
            title = "Meta Ads",
            description = "Planejar, revisar e acompanhar campanhas.",
            availability = ActionAvailability.LIMITED,
            defaultMode = ActionMode.GUIDED,
            approvalHint = true,
        ),
        ActionCard(
            type = ActionType.SOCIAL_INBOX,
            title = "Atender clientes",
            description = "Comentários, Directs, leads e escalonamentos.",
            availability = ActionAvailability.LIMITED,
            defaultMode = ActionMode.GUIDED,
        ),
        ActionCard(
            type = ActionType.ANALYTICS,
            title = "Analisar resultados",
            description = "Instagram, campanhas e performance.",
            availability = ActionAvailability.AVAILABLE,
            defaultMode = ActionMode.AUTO,
        ),
        ActionCard(
            type = ActionType.COMMERCIAL,
            title = "Comercial",
            description = "Leads, propostas, patrocínios e parceiros.",
            availability = ActionAvailability.UNAVAILABLE,
            defaultMode = ActionMode.GUIDED,
            reason = "Aguardando capability executável.",
        ),
    )

    override suspend fun videoOptions(): List<VideoCreationOption> = VIDEO_CREATION_OPTIONS

    override suspend fun prepare(request: TocaActionRequest): TocaAction = TocaAction(
        actionId = "ACT-DEMO-001",
        correlationId = "CORR-DEMO-001",
        request = request,
        state = ActionState.READY,
    )

    override fun executionPreview(action: TocaAction): List<ActionEvent> {
        val route = action.request.inputs["video_route"]
        return listOfNotNull(
            ActionEvent(1, "Contexto identificado", ActionState.COMPLETED),
            route?.let { ActionEvent(2, "Rota de vídeo selecionada: $it", ActionState.COMPLETED) },
            ActionEvent(3, "Source binding e verdade criativa validados", ActionState.COMPLETED),
            ActionEvent(4, "Shot map, ranking e anti-repetição aplicados", ActionState.COMPLETED),
            ActionEvent(5, "Master, approval e cover em produção", ActionState.RUNNING),
            ActionEvent(6, "QA visual e factual", ActionState.DRAFT),
            ActionEvent(7, "Preparar resultado", ActionState.DRAFT),
        )
    }
}
