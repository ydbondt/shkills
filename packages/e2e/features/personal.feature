Feature: A skill of your own
  Trying a skill out used to mean publishing it to the company, because
  publishing was the only way onto a machine. A personal skill is the same skill
  with a smaller audience: no review, your own machines, nobody else's — until
  you offer it, and a curator agrees.

  Background:
    Given these people:
      | name        | email          | role    | department  |
      | Maya Chen   | maya@acme.test | admin   | engineering |
      | Rob Alvarez | rob@acme.test  | curator | engineering |
      | Dana Okafor | dana@acme.test | member  | engineering |

  @AC-59
  Scenario: Writing a skill only you can see, and having it on your machine
    Given a machine called "laptop"
    And I am signed in as "dana@acme.test"
    When I open the "propose a skill" page
    And I click "editor-visibility-personal"
    And I type "Scratch Notes" into "editor-title"
    And I type into "editor-description":
      """
      Use when taking rough notes during an incident, to keep the timeline straight.
      """
    And I type into "editor-body":
      """
      Write the timeline first and the cause afterwards, never the other way round.
      """
    And I click "editor-submit"
    Then I am taken to the skill "scratch-notes"
    And "skill-detail" is marked "visibility" as "personal"
    And I see "skill-personal"
    When "dana@acme.test" links the machine "laptop"
    Then the machine "laptop" has the skill "scratch-notes"
    And the skill "scratch-notes" on the machine "laptop" says "timeline first"

  @AC-60
  Scenario: Nobody else can see it, by any route
    Given "dana@acme.test" has a skill of their own called "scratch-notes"
    And a collection "backend"
    And a machine called "robs-laptop"
    And I am signed in as "rob@acme.test"
    When I open the "catalog" page
    Then I do not see "skill-card-scratch-notes"
    And "rob@acme.test" cannot see the skill "scratch-notes"
    And "maya@acme.test" cannot see the skill "scratch-notes"
    When "rob@acme.test" tries to put "scratch-notes" into the collection "backend"
    Then the server refuses, saying "no such skill"
    When "rob@acme.test" links the machine "robs-laptop"
    Then the machine "robs-laptop" does not have the skill "scratch-notes"

  @AC-61
  Scenario: Changing it publishes at once, and reaches your other machine
    Given "dana@acme.test" has a skill of their own called "scratch-notes"
    And a machine called "laptop"
    And a machine called "desktop"
    And "dana@acme.test" links the machine "laptop"
    And "dana@acme.test" links the machine "desktop"
    And I am signed in as "dana@acme.test"
    When I open the skill "scratch-notes"
    And I click "skill-edit"
    And I type into "editor-body":
      """
      Write the timeline first, and put the times in UTC so they line up later.
      """
    And I click "editor-submit"
    Then I am taken to the skill "scratch-notes"
    When I click "tab-history"
    Then "version-status-2" is marked "status" as "approved"
    When Claude starts on the machine "desktop"
    Then the skill "scratch-notes" on the machine "desktop" says "in UTC"
    And the machine "desktop" knows "scratch-notes" as version 2

  @AC-62
  Scenario: Offering it puts it in front of a curator
    Given "dana@acme.test" has a skill of their own called "scratch-notes"
    And I am signed in as "dana@acme.test"
    When I open the skill "scratch-notes"
    And I click "skill-share"
    And I click "share-confirm"
    Then "skill-detail" is marked "share-status" as "pending"
    And I see "share-request"
    Given I am signed in as "rob@acme.test"
    When I open the "review" page
    Then I see "share-request-scratch-notes"
    And "share-request-scratch-notes" says "Dana Okafor"

  @AC-63
  Scenario: Waiting for an answer, and being told no, both leave it exactly where it was
    Given "dana@acme.test" has a skill of their own called "scratch-notes"
    And a machine called "laptop"
    And "dana@acme.test" links the machine "laptop"
    And "dana@acme.test" has offered "scratch-notes" to everybody
    And I am signed in as "rob@acme.test"
    When I open the "catalog" page
    Then I do not see "skill-card-scratch-notes"
    When Claude starts on the machine "laptop"
    Then the machine "laptop" has the skill "scratch-notes"
    When I open the "review" page
    And I click "share-decline-scratch-notes"
    And I type into "share-decline-note":
      """
      Useful, but too tied to your own project to hand to everybody.
      """
    And I click "share-decline-submit"
    Then I do not see "share-request-scratch-notes"
    And "maya@acme.test" cannot see the skill "scratch-notes"
    Given I am signed in as "dana@acme.test"
    When I open the skill "scratch-notes"
    Then "share-declined" says "too tied to your own project"
    And "skill-detail" is marked "visibility" as "personal"
    When Claude starts on the machine "laptop"
    Then the machine "laptop" has the skill "scratch-notes"

  @AC-64
  Scenario: Once a curator agrees it is an ordinary company skill
    Given "dana@acme.test" has a skill of their own called "scratch-notes"
    And a machine called "robs-laptop"
    And "rob@acme.test" links the machine "robs-laptop"
    And "dana@acme.test" has offered "scratch-notes" to everybody
    And I am signed in as "rob@acme.test"
    When I open the "review" page
    And I click "share-approve-scratch-notes"
    And I open the "catalog" page
    Then I see "skill-card-scratch-notes"
    And "skill-card-scratch-notes" is marked "visibility" as "shared"
    When I click "skill-subscribe-scratch-notes"
    And Claude starts on the machine "robs-laptop"
    Then the machine "robs-laptop" has the skill "scratch-notes"
    And the machine "robs-laptop" knows "scratch-notes" as version 1
