Feature: Onboarding a machine
  The whole setup is one command and one confirmation. After that nobody ever
  types a Shkills command again — a hook does it at the start of every session.

  Background:
    Given these people:
      | name        | email          | role    | department  |
      | Maya Chen   | maya@acme.test | admin   | engineering |
      | Rob Alvarez | rob@acme.test  | curator | engineering |
    And "maya@acme.test" has published the skill "writing-style"
    And a company-wide collection "everyone" containing:
      | writing-style |

  @AC-28 @AC-45
  Scenario: The portal hands out one command, and the server serves what it downloads
    Given I am signed in as "rob@acme.test"
    When I open the "your setup" page
    Then "install-command" says "install.sh | sh"
    And the installer can be downloaded
    And the CLI it downloads can be downloaded
    And the service reports itself healthy
    And the session cookie is not marked Secure

  @AC-29 @AC-31 @AC-33
  Scenario: Linking a machine, and never having to think about it again
    Given a machine called "rob-laptop"
    And the machine "rob-laptop" already has Claude settings:
      """
      {
        "model": "opus",
        "hooks": {
          "SessionStart": [
            { "hooks": [{ "type": "command", "command": "echo good morning" }] }
          ]
        }
      }
      """
    When "rob@acme.test" links the machine "rob-laptop"
    Then the terminal says "Linked as Rob Alvarez"
    And the machine "rob-laptop" refreshes skills when Claude starts
    And the machine "rob-laptop" has the skill "writing-style"
    And the settings on "rob-laptop" still contain "model"
    And Claude on "rob-laptop" still runs "echo good morning" at session start
    When I open the "your setup" page
    Then I see "machine-rob-laptop"

  @AC-29
  Scenario: The approval names the machine that is asking
    Given a machine called "rob-devbox"
    And I am signed in as "rob@acme.test"
    When "rob@acme.test" links the machine "rob-devbox"
    Then the terminal says "Linked as Rob Alvarez"
    When I open the "your setup" page
    Then "machine-rob-devbox" says "rob-devbox"

  @AC-30
  Scenario: A link request can be refused, and the code is then dead
    Given a machine called "not-mine"
    When "rob@acme.test" refuses to link the machine "not-mine"
    Then the machine "not-mine" does not have the skill "writing-style"
    When that code is used again
    Then "link-error" says "already used"

  @AC-32
  Scenario: Revoking a machine stops it syncing
    Given a machine called "old-laptop"
    When "rob@acme.test" links the machine "old-laptop"
    Then the machine "old-laptop" has the skill "writing-style"
    When I open the "your setup" page
    And I click "machine-revoke-old-laptop"
    Then I see a message saying "That machine can no longer sync"
    And I do not see "machine-old-laptop"
    When the machine "old-laptop" syncs
    Then the terminal says "expired"
    And the command succeeds
