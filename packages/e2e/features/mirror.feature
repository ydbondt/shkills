@with-a-git-repository
Feature: Taking the skills with you
  Skills live in this server's database, so leaving Shkills would mean leaving
  them behind. An administrator points the deployment at a git repository and
  the company skills are written into it as they change — one way, because what
  is being solved is leaving, not editing in two places.

  Background:
    Given these people:
      | name        | email          | role    | department  |
      | Maya Chen   | maya@acme.test | admin   | engineering |
      | Rob Alvarez | rob@acme.test  | curator | engineering |
      | Dana Okafor | dana@acme.test | member  | engineering |
    And "rob@acme.test" has published the skill "commit-messages" saying:
      """
      Write every commit subject as type(scope): summary.
      """

  @AC-65
  Scenario: Only an administrator sets it up, and the token never comes back
    Given I am signed in as "rob@acme.test"
    When I open the "people" page
    Then I do not see "mirror-panel"
    Given I am signed in as "maya@acme.test"
    When I open the "people" page
    And I tick "mirror-enabled"
    And I type "acme" into "mirror-owner"
    And I type "skills" into "mirror-repo"
    And I click "mirror-save"
    Then I see a message saying "Saved"
    And "mirror-panel" is marked "enabled" as "true"
    And the mirror settings never mention the token

  @AC-66
  Scenario: The repository gets the real file, and something explaining it
    Given the skills are mirrored into "acme/skills"
    When an administrator pushes the mirror
    Then the repository holds the skill "commit-messages"
    And the mirrored "commit-messages" is exactly what a machine is given
    And the repository's index explains how to use the skills without Shkills

  @AC-67
  Scenario: A change reaches the repository, and so does a removal
    Given the skills are mirrored into "acme/skills"
    And an administrator pushes the mirror
    When "rob@acme.test" has published a change to "commit-messages" saying:
      """
      Write every commit subject as type(scope): summary, under 72 characters.
      """
    And an administrator pushes the mirror
    Then the mirrored "commit-messages" says "under 72 characters"
    When the skill "commit-messages" is archived
    And an administrator pushes the mirror
    Then the repository does not hold the skill "commit-messages"

  @AC-68
  Scenario: A skill somebody is keeping to themselves never leaves
    Given "dana@acme.test" has a skill of their own called "scratch-notes"
    And the skills are mirrored into "acme/skills"
    When an administrator pushes the mirror
    Then the repository holds the skill "commit-messages"
    And the repository does not hold the skill "scratch-notes"
    When "dana@acme.test" has offered "scratch-notes" to everybody
    And "rob@acme.test" agrees to share "scratch-notes"
    And an administrator pushes the mirror
    Then the repository holds the skill "scratch-notes"

  @AC-69
  Scenario: A repository that cannot be reached stops nothing
    Given the skills are mirrored into "acme/skills"
    And the repository is unreachable
    When "rob@acme.test" has published the skill "code-review"
    And an administrator pushes the mirror
    Then the mirror says it failed
    And the skill "code-review" is live for everybody
    When the repository can be reached again
    And an administrator pushes the mirror
    Then the repository holds the skill "code-review"
    And the repository holds the skill "commit-messages"

  @AC-70
  Scenario: Whatever else the repository holds is left alone
    Given the skills are mirrored into "acme/skills"
    And the repository already holds "NOTES.md"
    When an administrator pushes the mirror
    Then the repository still holds "NOTES.md"
    When the skill "commit-messages" is archived
    And an administrator pushes the mirror
    Then the repository does not hold the skill "commit-messages"
    And the repository still holds "NOTES.md"
