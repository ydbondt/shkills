Feature: Updating, rolling back and removing
  Skills change. A curator can publish a change, undo one, take a skill away and
  bring it back — and every one of those moves is written down.

  Background:
    Given these people:
      | name        | email          | role    | department  |
      | Maya Chen   | maya@acme.test | admin   | engineering |
      | Rob Alvarez | rob@acme.test  | curator | engineering |
    And "rob@acme.test" has published the skill "commit-messages" saying:
      """
      Write every commit subject as type(scope): summary.
      """

  @AC-16
  Scenario: Editing a skill makes a new version, and the history shows both
    Given I am signed in as "rob@acme.test"
    When I open the skill "commit-messages"
    And I click "skill-edit"
    And I type into "editor-body":
      """
      Write every commit subject as type(scope): summary, under 72 characters.
      """
    And I type "Added the length rule" into "editor-change-note"
    And I click "editor-submit"
    Then I am taken to the skill "commit-messages"
    And "skill-body" says "under 72 characters"
    When I click "tab-history"
    Then I see "version-2"
    And "version-status-2" is marked "status" as "approved"
    And "version-status-1" is marked "status" as "superseded"
    And "version-2" says "Added the length rule"
    And "version-2" says "Rob Alvarez"

  @AC-17
  Scenario: A curator rolls back to the previous version
    Given "rob@acme.test" has published a change to "commit-messages" saying:
      """
      Commit subjects can say whatever, we will sort it out in review.
      """
    And I am signed in as "rob@acme.test"
    When I open the skill "commit-messages"
    Then "skill-body" says "we will sort it out in review"
    When I click "tab-history"
    And I click "rollback-1"
    Then I see a message saying "Rolled back to v1"
    When I click "tab-skill"
    Then "skill-body" says "type(scope): summary"
    And "skill-body" does not say "we will sort it out in review"

  @AC-18
  Scenario: A curator archives a skill after confirming, and can restore it
    Given I am signed in as "rob@acme.test"
    When I open the skill "commit-messages"
    And I click "skill-archive"
    Then I see "archive-dialog"
    When I click "archive-cancel"
    Then I do not see "archive-dialog"
    And I see "skill-detail"
    When I click "skill-archive"
    And I click "archive-confirm"
    Then I am taken to the "catalog" page
    And I do not see "skill-card-commit-messages"
    When I open the skill "commit-messages"
    Then I see "skill-archived"
    And I do not see "skill-subscribe"
    When I click "skill-restore"
    Then I see a message saying "Restored"
    And I do not see "skill-archived"

  @AC-19
  Scenario: Everything that happened is in the audit trail
    Given "rob@acme.test" has published a change to "commit-messages" saying:
      """
      Reference the Jira ticket on its own trailing line.
      """
    And a collection "engineering" containing:
      | commit-messages |
    And I am signed in as "maya@acme.test"
    When I open the "people" page
    Then I see "audit-event-skill.publish"
    And I see "audit-event-collection.create"
    And I see "audit-event-collection.add_skill"
    And "audit-log" says "commit-messages"
    And "audit-log" says "Rob Alvarez"
