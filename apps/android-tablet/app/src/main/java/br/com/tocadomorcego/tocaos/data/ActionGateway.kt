package br.com.tocadomorcego.tocaos.data

import br.com.tocadomorcego.tocaos.domain.ActionAvailability
import br.com.tocadomorcego.tocaos.domain.ActionCard
import br.com.tocadomorcego.tocaos.domain.ActionEvent
import br.com.tocadomorcego.tocaos.domain.ActionMode
import br.com.tocadomorcego.tocaos.domain.ActionState
import br.com.tocadomorcego.tocaos.domain.ActionType
import br.com.tocadomorcego.tocaos.domain.TocaAction
import br.com.tocadomorcego.tocaos.domain.TocaActionRequest

interface ActionGateway {
    fun actionCards(): List<ActionCard>
    fun prepare(request: TocaActionRequest): TocaAction
    fun executionPreview(action: TocaAction): List<ActionEvent>
}

/**
 * Local-only gateway used by the first UI slice. It does not contact providers and it must not be
 * interpreted as capability truth. The production implementation will hydrate the same models from
 * the TOCA App Gateway/BFF and live `system.capabilities` output.
 */
class FakeActionGateway : ActionGateway {
    override fun actionCards(): List<ActionCard> = listOf(
        ActionCard(
            type = ActionType.CREATE_CONTENT,
            title = "Criar conteúdo",
            description = "Story, Feed, Carrossel, Reels e vídeo.",
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

    override fun prepare(request: TocaActionRequest): TocaAction = TocaAction(
        actionId = "ACT-DEMO-001",
        correlationId = "CORR-DEMO-001",
        request = request,
        state = ActionState.READY,
    )

    override fun executionPreview(action: TocaAction): List<ActionEvent> = listOf(
        ActionEvent(1, "Contexto identificado", ActionState.COMPLETED),
        ActionEvent(2, "Edição e fatos validados", ActionState.COMPLETED),
        ActionEvent(3, "Banco de mídia analisado", ActionState.COMPLETED),
        ActionEvent(4, "Criativo em produção", ActionState.RUNNING),
        ActionEvent(5, "QA visual e factual", ActionState.DRAFT),
        ActionEvent(6, "Preparar resultado", ActionState.DRAFT),
    )
}
