Feature: The portal itself
  Taste is not testable, but two things that break objectively are: a page that
  scrolls sideways on a phone, and text nobody can read in the other colour scheme.

  Background:
    Given these people:
      | name        | email          | role    | department  |
      | Maya Chen   | maya@acme.test | admin   | engineering |
    And "maya@acme.test" has published the skill "commit-messages"
    And a collection "engineering" containing:
      | commit-messages |

  @AC-43
  Scenario Outline: <page> fits on a phone
    Given I am signed in as "maya@acme.test"
    When I resize the window to 390 by 844
    And I open the "<page>" page
    Then the page does not scroll sideways

    Examples:
      | page       |
      | catalog    |
      | collections |
      | review     |
      | your setup |
      | people     |

  @AC-43
  Scenario: Sign-in fits on a phone
    Given I am signed out
    When I resize the window to 390 by 844
    And I open the "sign-in" page
    Then the page does not scroll sideways

  @AC-44
  Scenario: The portal is readable in dark mode
    Given the browser is in dark mode
    And I am signed in as "maya@acme.test"
    When I open the "catalog" page
    Then I see "skill-card-commit-messages"
    And the text is readable against the background
    When I open the skill "commit-messages"
    Then the text is readable against the background

  @AC-44
  Scenario: The portal is readable in light mode
    Given I am signed in as "maya@acme.test"
    When I open the "catalog" page
    Then the text is readable against the background
