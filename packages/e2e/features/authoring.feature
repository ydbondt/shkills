Feature: Writing a skill
  A skill has to carry everything Claude needs to pick it up and follow it, plus
  the things a company needs to organise it. The portal shows the exact file
  that ends up on people's machines, so nobody has to trust that it is right.

  Background:
    Given these people:
      | name        | email          | role    | department  |
      | Maya Chen   | maya@acme.test | admin   | engineering |
      | Rob Alvarez | rob@acme.test  | curator | engineering |

  @AC-7 @AC-8
  Scenario: A skill carries its trigger, its instructions and its extra data
    Given I am signed in as "rob@acme.test"
    When I open the "propose a skill" page
    And I type "Code Review Standards" into "editor-title"
    And I type "Use when reviewing a pull request, to apply the Acme review checklist." into "editor-description"
    And I type into "editor-body":
      """
      Review in this order and stop at the first level that has problems.

      1. Correctness — does it do what the ticket asked?
      2. Tests — a test that cannot fail is not a test.
      """
    And I choose "engineering" in "editor-category"
    And I click "editor-audience-engineering"
    And I type "review, quality" into "editor-tags"
    And I tick "editor-user-invocable"
    And I click "editor-submit"
    Then I am taken to the skill "code-review-standards"
    And "skill-title" says "Code Review Standards"
    And "skill-category" says "engineering"
    And "skill-description" says "Use when reviewing a pull request"
    When I click "tab-file"
    Then "skill-file" says "name: code-review-standards"
    And "skill-file" says "description: \"Use when reviewing a pull request, to apply the Acme review checklist.\""
    And "skill-file" says "user-invocable: true"
    And "skill-file" says "# Code Review Standards"
    And "skill-file" says "a test that cannot fail is not a test"
    And "skill-file" says "Category: engineering · Version: 1 · Audience: engineering · Tags: review, quality"

  @AC-9
  Scenario: The instructions can be previewed as Claude will render them
    Given I am signed in as "rob@acme.test"
    When I open the "propose a skill" page
    And I type into "editor-body":
      """
      ## When to stop

      - Ship the smallest thing that is true
      - Say why, not what
      """
    And I click "editor-preview-toggle"
    Then "editor-preview" says "When to stop"
    And "editor-preview" says "Ship the smallest thing that is true"

  @AC-7
  Scenario: A skill without a real trigger description is refused
    Given I am signed in as "rob@acme.test"
    When I open the "propose a skill" page
    And I type "Half A Skill" into "editor-title"
    And I type "too short" into "editor-description"
    And I type into "editor-body":
      """
      This body is long enough to be accepted on its own.
      """
    And I click "editor-submit"
    Then I see "editor-page"
    And I do not see "skill-detail"
    And there is no skill called "half-a-skill"
