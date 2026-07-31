Feature: Propagation
  The claim the whole product rests on: change a skill here, and it is on
  everybody's machine at the start of their next Claude session. Every scenario
  below runs the real CLI against a real server and looks at real files.

  Background:
    Given these people:
      | name        | email          | role    | department  |
      | Maya Chen   | maya@acme.test | admin   | engineering |
      | Rob Alvarez | rob@acme.test  | curator | engineering |
    And "rob@acme.test" has published the skill "commit-messages" saying:
      """
      Write every commit subject as type(scope): summary.
      """
    And "rob@acme.test" has published the skill "code-review"
    And a company-wide collection "everyone" containing:
      | commit-messages |
    And a machine called "laptop"

  @AC-33
  Scenario: Linking a machine puts the right skills on it
    When "rob@acme.test" links the machine "laptop"
    Then the machine "laptop" has the skill "commit-messages"
    And the skill "commit-messages" on the machine "laptop" says "type(scope): summary"
    And the skill "commit-messages" on the machine "laptop" says "Managed by Shkills"
    And the machine "laptop" does not have the skill "code-review"
    And the machine "laptop" has exactly 1 skill

  @AC-34
  Scenario: A published change reaches the machine at the next Claude session
    Given "rob@acme.test" links the machine "laptop"
    And I note the skill "commit-messages" on the machine "laptop"
    When I open the skill "commit-messages"
    And I click "skill-edit"
    And I type into "editor-body":
      """
      Write every commit subject as type(scope): summary, under 72 characters.
      """
    And I type "Added the length rule" into "editor-change-note"
    And I click "editor-submit"
    And Claude starts on the machine "laptop"
    Then the skill "commit-messages" on the machine "laptop" says "under 72 characters"
    And the machine "laptop" knows "commit-messages" as version 2
    And the command succeeds

  @AC-35
  Scenario: When nothing has changed, a session start is a cheap no-op
    Given "rob@acme.test" links the machine "laptop"
    And I note the skill "commit-messages" on the machine "laptop"
    When Claude starts on the machine "laptop"
    Then the command succeeds
    And the skill "commit-messages" on the machine "laptop" is exactly as it was
    When the machine "laptop" syncs
    Then the terminal says "Skills are up to date"

  @AC-36
  Scenario: A skill taken in the portal arrives on the machine
    Given "rob@acme.test" links the machine "laptop"
    When I open the "catalog" page
    And I click "skill-subscribe-code-review"
    And Claude starts on the machine "laptop"
    Then the machine "laptop" has the skill "code-review"
    And the machine "laptop" has exactly 2 skills

  @AC-37
  Scenario: A rollback reaches the machine too
    Given "rob@acme.test" links the machine "laptop"
    And I note the skill "commit-messages" on the machine "laptop"
    And "rob@acme.test" has published a change to "commit-messages" saying:
      """
      Commit subjects can say whatever, we will sort it out in review.
      """
    When Claude starts on the machine "laptop"
    Then the skill "commit-messages" on the machine "laptop" says "we will sort it out"
    When I open the skill "commit-messages"
    And I click "tab-history"
    And I click "rollback-1"
    And Claude starts on the machine "laptop"
    Then the skill "commit-messages" on the machine "laptop" is exactly as it was

  @AC-38
  Scenario: Archiving takes a skill off the machine, and restoring brings it back
    Given "rob@acme.test" links the machine "laptop"
    When I open the skill "commit-messages"
    And I click "skill-archive"
    And I click "archive-confirm"
    And Claude starts on the machine "laptop"
    Then the machine "laptop" does not have the skill "commit-messages"
    When I open the skill "commit-messages"
    And I click "skill-restore"
    And Claude starts on the machine "laptop"
    Then the machine "laptop" has the skill "commit-messages"

  @AC-39
  Scenario: A skill somebody wrote themselves is never overwritten
    Given the machine "laptop" has a skill of its own called "commit-messages" saying:
      """
      ---
      name: commit-messages
      description: My own rules, thanks.
      ---

      Whatever I feel like, in my own words.
      """
    And I note the skill "commit-messages" on the machine "laptop"
    When "rob@acme.test" links the machine "laptop"
    Then the terminal says "skipped commit-messages"
    And the terminal says "a skill of your own already uses that name"
    And the skill "commit-messages" on the machine "laptop" is exactly as it was
    And the command succeeds

  @AC-40
  Scenario: Deleting the marker hands the directory back
    Given "rob@acme.test" links the machine "laptop"
    And the machine "laptop" is no longer letting Shkills manage "commit-messages"
    And somebody has edited the skill "commit-messages" on the machine "laptop" to say:
      """
      I have taken this one over and made it mine.
      """
    And I note the skill "commit-messages" on the machine "laptop"
    When "rob@acme.test" has published a change to "commit-messages" saying:
      """
      Reference the Jira ticket on its own trailing line.
      """
    And Claude starts on the machine "laptop"
    Then the skill "commit-messages" on the machine "laptop" is exactly as it was
    And the skill "commit-messages" on the machine "laptop" does not say "Jira"

  @AC-41
  Scenario: A Shkills that is down never stops Claude starting
    Given "rob@acme.test" links the machine "laptop"
    When Claude starts on the machine "laptop" while Shkills is unreachable
    Then the command succeeds
    And the machine "laptop" has the skill "commit-messages"

  @AC-42
  Scenario: A revoked machine stops receiving changes
    Given "rob@acme.test" links the machine "laptop"
    When I open the "your setup" page
    And I click "machine-revoke-laptop"
    And "rob@acme.test" has published a change to "commit-messages" saying:
      """
      Reference the Jira ticket on its own trailing line.
      """
    And Claude starts on the machine "laptop"
    Then the command succeeds
    And the skill "commit-messages" on the machine "laptop" does not say "Jira"
