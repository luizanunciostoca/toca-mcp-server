def authorized_issue_mutation:
  (.actor.login == $owner) and
  (
    (.path == ".github/workflows/instagram-engagement-limited-activation.yml" and
      ((.display_title // "") | startswith("PRODUCTION AUTHORIZATION — Instagram engagement LIMITED activation AUTO"))) or
    (.path == ".github/workflows/instagram-engagement-limited-runtime-refresh.yml" and
      ((.display_title // "") | startswith("PRODUCTION AUTHORIZATION — Instagram engagement LIMITED runtime refresh AUTO"))) or
    (.path == ".github/workflows/instagram-engagement-comment-limited-promotion.yml" and
      ((.display_title // "") | startswith("PRODUCTION AUTHORIZATION — Instagram engagement COMMENT LIMITED promotion AUTO"))) or
    (.path == ".github/workflows/instagram-engagement-tiered-knowledge-shadow.yml" and
      ((.display_title // "") | startswith("PRODUCTION AUTHORIZATION — Instagram tiered knowledge shadow AUTO"))) or
    (.path == ".github/workflows/instagram-engagement-faq-expansion-limited-refresh.yml" and
      ((.display_title // "") | startswith("PRODUCTION AUTHORIZATION — Instagram FAQ expansion LIMITED refresh AUTO"))) or
    (.path == ".github/workflows/instagram-engagement-faq-knowledge-recovery.yml" and
      ((.display_title // "") | startswith("PRODUCTION AUTHORIZATION — Instagram FAQ knowledge RECOVERY AUTO")))
  );

[
  .workflow_runs[]
  | select(.id != $self)
  | select(.event == "issues")
  | select(.head_branch == "main")
  | select(authorized_issue_mutation)
] | length
