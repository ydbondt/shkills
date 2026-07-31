Feature: Collections
  A collection is a whole role's worth of skills in one decision — and the one
  mechanism that makes "everyone uses the same skills" true rather than hoped for.

  Background:
    Given these people:
      | name         | email           | role    | department  |
      | Maya Chen    | maya@acme.test  | admin   | engineering |
      | Sofia Novak  | sofia@acme.test | curator | sales       |
      | Inès Perrot  | ines@acme.test  | member  | engineering |
    And "maya@acme.test" has published the skill "commit-messages"
    And "maya@acme.test" has published the skill "code-review"
    And "maya@acme.test" has published the skill "writing-style"

  @AC-23
  Scenario: A curator makes a collection and fills it
    Given I am signed in as "maya@acme.test"
    When I open the "collections" page
    And I click "new-collection"
    And I type "Engineering" into "collection-name"
    And I type "Conventions every engineer follows." into "collection-description"
    And I click "collection-create"
    Then I see "collection-card-engineering"
    When I open the collection "engineering"
    Then I see "collection-empty"
    When I click "collection-add-skill"
    And I type "commit" into "add-skill-search"
    And I click "add-skill-commit-messages"
    Then I see "collection-skill-commit-messages"
    And "collection-count" says "1 skill"

  @AC-24
  Scenario: Joining a collection installs everything in it
    Given a collection "engineering" containing:
      | commit-messages |
      | code-review     |
    And I am signed in as "ines@acme.test"
    When I open the "collections" page
    And I click "collection-join-engineering"
    Then I see a message saying "Arrives on your next Claude session"
    When I open the "your setup" page
    Then I see "my-collection-engineering"
    And I see "my-skill-commit-messages"
    And I see "my-skill-code-review"
    And "my-skill-source-commit-messages" says "via Engineering"

  @AC-25
  Scenario: A skill added later reaches everyone who already joined
    Given a collection "engineering" containing:
      | commit-messages |
    And "ines@acme.test" has joined the collection "engineering"
    And I am signed in as "maya@acme.test"
    When I open the collection "engineering"
    And I click "collection-add-skill"
    And I click "add-skill-code-review"
    Then I see "collection-skill-code-review"
    Given I am signed in as "ines@acme.test"
    When I open the "your setup" page
    Then I see "my-skill-code-review"

  @AC-26
  Scenario: A company-wide collection applies to everyone and cannot be left
    Given a company-wide collection "everyone" containing:
      | writing-style |
    And I am signed in as "ines@acme.test"
    When I open the "collections" page
    Then I see "collection-locked-everyone"
    And I do not see "collection-join-everyone"
    When I open the "your setup" page
    Then I see "my-collection-everyone"
    And I see "my-skill-writing-style"
    When "ines@acme.test" tries to leave the collection "everyone"
    Then the server refuses, saying "company default collections cannot be unsubscribed"

  @AC-27
  Scenario: Your setup is the union of what you joined and what you took
    Given a company-wide collection "everyone" containing:
      | writing-style |
    And a collection "engineering" containing:
      | commit-messages |
      | code-review     |
    And "ines@acme.test" has joined the collection "engineering"
    And "ines@acme.test" has added the skill "code-review"
    And I am signed in as "ines@acme.test"
    When I open the "your setup" page
    Then I see "my-skill-writing-style"
    And I see "my-skill-commit-messages"
    And I see "my-skill-code-review"
    And "my-skill-source-code-review" says "direct"
    And "my-skill-source-code-review" says "Engineering"
    And "my-skill-source-writing-style" says "company default"

  @AC-23
  Scenario: A curator takes a skill back out of a collection
    Given a collection "engineering" containing:
      | commit-messages |
      | code-review     |
    And "ines@acme.test" has joined the collection "engineering"
    And I am signed in as "sofia@acme.test"
    When I open the collection "engineering"
    And I click "collection-remove-code-review"
    Then I do not see "collection-skill-code-review"
    Given I am signed in as "ines@acme.test"
    When I open the "your setup" page
    Then I see "my-skill-commit-messages"
    And I do not see "my-skill-code-review"
