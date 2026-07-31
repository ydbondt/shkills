Feature: Finding and choosing skills
  Engineering, sales and product do not want each other's skills. The catalog is
  how somebody finds the handful that are theirs, and takes only those.

  Background:
    Given these people:
      | name         | email           | role    | department  |
      | Maya Chen    | maya@acme.test  | admin   | engineering |
      | Sofia Novak  | sofia@acme.test | curator | sales       |
    And "maya@acme.test" has published the skill "commit-messages"
    And "maya@acme.test" has published the skill "code-review"
    And "sofia@acme.test" has published the skill "discovery-call"

  @AC-20
  Scenario: Searching narrows the catalog
    Given I am signed in as "sofia@acme.test"
    When I open the "catalog" page
    Then I see "skill-card-commit-messages"
    When I type "discovery" into "catalog-search"
    Then I see "skill-card-discovery-call"
    And I do not see "skill-card-commit-messages"
    When I type "nothing like this exists" into "catalog-search"
    Then I see "catalog-empty"

  @AC-20
  Scenario: Filtering by category narrows the catalog
    Given I am signed in as "sofia@acme.test"
    When I open the "catalog" page
    And I click "filter-category-engineering"
    Then I see "skill-card-commit-messages"
    And I see "skill-card-code-review"
    And I do not see "skill-card-discovery-call"
    When I click "filter-all"
    Then I see "skill-card-discovery-call"

  @AC-21
  Scenario: Somebody takes one skill, then puts it back
    Given I am signed in as "sofia@acme.test"
    When I open the "catalog" page
    And I click "skill-subscribe-code-review"
    Then I see a message saying "It arrives on your next Claude session"
    And "skill-subscribe-code-review" is marked "subscribed" as "true"
    When I open the "your setup" page
    Then I see "my-skill-code-review"
    When I open the skill "code-review"
    And I click "skill-subscribe"
    Then "skill-subscribe" is marked "subscribed" as "false"
    When I open the "your setup" page
    Then I do not see "my-skill-code-review"

  @AC-22
  Scenario: "Mine" shows only what this person has taken
    Given "sofia@acme.test" has added the skill "discovery-call"
    And I am signed in as "sofia@acme.test"
    When I open the "catalog" page
    And I click "filter-mine"
    Then I see "skill-card-discovery-call"
    And I do not see "skill-card-commit-messages"
