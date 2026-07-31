Feature: Accounts and access
  Shkills is a company portal, so it starts with somebody signing in, and the
  first person to arrive at a brand new instance is the one who runs it.

  Background:
    Given these people:
      | name          | email          | role    | department  |
      | Maya Chen     | maya@acme.test | admin   | engineering |
      | Rob Alvarez   | rob@acme.test  | curator | engineering |
      | Inès Perrot   | ines@acme.test | member  | engineering |

  @AC-1
  Scenario: The first account on a new Shkills becomes the administrator
    Given I am signed in as "maya@acme.test"
    When I click "account-button"
    Then "account-role" says "admin"

  @AC-1
  Scenario: Somebody joins with their work email
    Given I am signed out
    When I open the "sign-in" page
    And I click "signin-toggle-mode"
    And I type "Dan Whitfield" into "signin-name"
    And I type "dan@acme.test" into "signin-email"
    And I type "a-long-enough-password" into "signin-password"
    And I choose "product" in "signin-department"
    And I click "signin-submit"
    Then I am taken to the "catalog" page
    When I click "account-button"
    Then "account-email" says "dan@acme.test"
    And "account-role" says "member"

  @AC-2
  Scenario: A signed-out visitor cannot reach the portal
    Given I am signed out
    When I open the "people" page
    Then I am taken to the "sign-in" page
    And I do not see "app-header"

  @AC-2
  Scenario: Signing in continues to the page that was asked for
    Given I am signed out
    When I open the "collections" page
    Then I am taken to the "sign-in" page
    When I type "rob@acme.test" into "signin-email"
    And I type "correct-horse-battery" into "signin-password"
    And I click "signin-submit"
    Then I am taken to the "collections" page

  @AC-3
  Scenario: The wrong password is refused
    Given I am signed out
    When I open the "sign-in" page
    And I type "maya@acme.test" into "signin-email"
    And I type "not-her-password" into "signin-password"
    And I click "signin-submit"
    Then "signin-error" says "incorrect email or password"
    And I do not see "app-header"

  @AC-4
  Scenario: A member can propose, but has no review queue and no people admin
    Given I am signed in as "ines@acme.test"
    Then I see "propose-skill"
    And I do not see "nav-review"
    And I do not see "nav-people"

  @AC-5
  Scenario: A curator reviews and can see the company, but cannot change anyone
    Given I am signed in as "rob@acme.test"
    Then I see "nav-review"
    When I open the "people" page
    Then I see "person-ines@acme.test"
    And "person-role-ines@acme.test" is marked "role" as "member"
    But "person-role-ines@acme.test" is marked "editable" as "false"

  @AC-5
  Scenario: An administrator can change somebody's role
    Given I am signed in as "maya@acme.test"
    When I open the "people" page
    And I choose "curator" in "person-role-ines@acme.test"
    Then I see a message saying "Inès Perrot is now a curator"
    When I reload the page
    Then "person-role-ines@acme.test" is marked "role" as "curator"
