Feature: Proposing and approving
  Anyone may write a skill; only a curator can put one on everybody's machine.
  Review never takes a working skill away from anyone while it is happening.

  Background:
    Given these people:
      | name        | email          | role    | department  |
      | Maya Chen   | maya@acme.test | admin   | engineering |
      | Rob Alvarez | rob@acme.test  | curator | engineering |
      | Inès Perrot | ines@acme.test | member  | engineering |

  @AC-10
  Scenario: A member's proposal waits, and reaches nobody in the meantime
    Given I am signed in as "ines@acme.test"
    When I open the "propose a skill" page
    And I type "Database Migrations" into "editor-title"
    And I type "Use when writing or reviewing a database migration, to keep them reversible." into "editor-description"
    And I type into "editor-body":
      """
      Every migration is two migrations: the one that goes forward and the one
      that comes back. Write both, and run the second one once before merging.
      """
    And I click "editor-submit"
    Then I see a message saying "Sent for review"
    And I am taken to the skill "database-migrations"
    And I see "skill-body-unpublished"
    And I do not see "skill-subscribe"
    When I open the "catalog" page
    Then I see "skill-unpublished-database-migrations"
    And I do not see "skill-subscribe-database-migrations"

  @AC-10 @AC-11
  Scenario: A curator approves a proposal and it goes live
    Given "ines@acme.test" has proposed the skill "database-migrations"
    And I am signed in as "rob@acme.test"
    Then "nav-review-badge" says "1"
    When I open the "review" page
    Then I see "proposal-database-migrations"
    And "proposal-kind-database-migrations" says "new skill"
    When I click "proposal-approve-database-migrations"
    Then I see a message saying "database-migrations is live"
    And I see "review-empty"
    When I open the "catalog" page
    Then I see "skill-subscribe-database-migrations"
    And "skill-version-database-migrations" says "v1"

  @AC-6 @AC-12
  Scenario: A curator declines with a note, and the author can read why
    Given "ines@acme.test" has proposed the skill "database-migrations"
    When "ines@acme.test" tries to approve the proposal for "database-migrations"
    Then the server refuses, saying "requires curator role"
    Given I am signed in as "rob@acme.test"
    When I open the "review" page
    And I click "proposal-decline-database-migrations"
    And I type "This overlaps with code-review — could it fold into that one?" into "decline-note"
    And I click "decline-submit"
    Then I see "review-empty"
    Given I am signed in as "ines@acme.test"
    When I open the skill "database-migrations"
    And I click "tab-history"
    Then "version-status-1" is marked "status" as "rejected"
    And "version-review-note-1" says "could it fold into that one?"
    And I do not see "skill-subscribe"

  @AC-13
  Scenario: A curator publishes their own skill without queueing it
    Given I am signed in as "rob@acme.test"
    When I open the "propose a skill" page
    And I type "Incident Response" into "editor-title"
    And I type "Use during a production incident, to run the Acme incident process." into "editor-description"
    And I type into "editor-body":
      """
      Mitigate first, understand second. A rollback you can explain tomorrow
      beats a root cause you find at 3am.
      """
    And I click "editor-submit"
    Then I am taken to the skill "incident-response"
    And I see "skill-subscribe"
    When I open the "review" page
    Then I see "review-empty"

  @AC-14
  Scenario: A curator can ask for a second pair of eyes anyway
    Given I am signed in as "rob@acme.test"
    When I open the "propose a skill" page
    And I type "Incident Response" into "editor-title"
    And I type "Use during a production incident, to run the Acme incident process." into "editor-description"
    And I type into "editor-body":
      """
      Mitigate first, understand second. Declare in #incidents with severity,
      one-line impact, and who is driving.
      """
    And I click "editor-send-for-review"
    Then I see a message saying "Sent for review"
    When I open the "review" page
    Then I see "proposal-incident-response"

  @AC-15
  Scenario: The live version keeps serving while a change is in review
    Given "rob@acme.test" has published the skill "code-review" saying:
      """
      Review in this order: correctness, tests, interfaces, style.
      """
    And "ines@acme.test" has proposed a change to "code-review" saying:
      """
      Review in whatever order you feel like, honestly.
      """
    And I am signed in as "maya@acme.test"
    When I open the skill "code-review"
    Then "skill-body" says "Review in this order"
    And "skill-body" does not say "whatever order you feel like"
    When I click "tab-file"
    Then "skill-file" says "Version: 1"
    When I open the "review" page
    Then I see "proposal-code-review"
    And "proposal-kind-code-review" says "v2"
