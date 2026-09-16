alter table instagram_engagement_knowledge_documents
  drop constraint if exists instagram_engagement_knowledge_documents_source_kind_check;

alter table instagram_engagement_knowledge_documents
  add constraint instagram_engagement_knowledge_documents_source_kind_check
  check (
    source_kind in (
      'OPERATIONS',
      'MENU_STRUCTURED',
      'LOCATION',
      'BRAND',
      'PRODUCTS',
      'POLICY',
      'OTHER'
    )
  );
