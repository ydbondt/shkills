Feature: Getting back in after a lost password
  A password is lost from a signed-out browser, which is the one state in which
  the portal can do nothing for you. So there are three ways back in, and which
  one a deployment uses depends only on whether it has a mail server.

  Scenarios tagged @with-a-mail-server get a Shkills that can send email.
  Untagged ones get a Shkills that cannot, which is what a freshly stood-up
  deployment is — and the case the administrator queue exists for.

  Background:
    Given these people:
      | name        | email          | role    | department  |
      | Maya Chen   | maya@acme.test | admin   | engineering |
      | Rob Alvarez | rob@acme.test  | curator | engineering |
      | Inès Perrot | ines@acme.test | member  | engineering |

  @AC-51
  Scenario: The way back in is on the sign-in page
    Given I am signed out
    When I open the "sign-in" page
    And I click "signin-forgot"
    Then I am taken to the "forgotten password" page
    And I see "forgot-form"

  @AC-51
  Scenario: Asking for a way back in, without an account to do it with
    Given I am signed out
    When I open the "forgotten password" page
    And I type "ines@acme.test" into "forgot-email"
    And I click "forgot-submit"
    Then I see "forgot-sent"
    And I do not see "app-header"

  @AC-52
  Scenario: The portal will not say whether an address belongs to anybody
    When "ines@acme.test" asks for a way back in
    Then an address nobody uses is answered exactly the same way

  @AC-52 @with-a-mail-server
  Scenario: An address nobody uses is not written to
    When "nobody@acme.test" asks for a way back in
    Then nothing is emailed to "nobody@acme.test"

  @AC-53 @AC-55 @with-a-mail-server
  Scenario: Following the link, choosing a password, and being signed in
    Given "ines@acme.test" is signed in somewhere else
    When "ines@acme.test" asks for a way back in
    And I follow the link that was emailed to "ines@acme.test"
    Then "reset-account" says "ines@acme.test"
    When I type "a-brand-new-password" into "reset-password"
    And I click "reset-submit"
    Then I am taken to the "catalog" page
    And "ines@acme.test" can sign in with "a-brand-new-password"
    But "ines@acme.test" cannot sign in with "correct-horse-battery"
    And "ines@acme.test" is signed out there

  @AC-54 @with-a-mail-server
  Scenario: A link works once
    When "ines@acme.test" asks for a way back in
    And I follow the link that was emailed to "ines@acme.test"
    And I type "a-brand-new-password" into "reset-password"
    And I click "reset-submit"
    Then I am taken to the "catalog" page
    When I follow that link again
    Then I see "reset-dead"
    And I do not see "reset-form"

  @AC-54 @with-a-mail-server
  Scenario: A newer link retires the one you were sent first
    When "ines@acme.test" asks for a way back in
    And I follow the link that was emailed to "ines@acme.test"
    Then I see "reset-form"
    When an administrator makes a newer link for "ines@acme.test"
    And I follow that link again
    Then I see "reset-dead"
    And I see "reset-ask-again"

  @AC-56 @with-a-mail-server
  Scenario: The emailed link names the address the person was using
    Given I reach the portal at "localhost"
    When I open the "forgotten password" page
    And I type "ines@acme.test" into "forgot-email"
    And I click "forgot-submit"
    Then I see "forgot-sent"
    And the email to "ines@acme.test" names the address I used

  @AC-57
  Scenario: With no mail server, an administrator hands the link over
    When "ines@acme.test" asks for a way back in
    And I am signed in as "maya@acme.test"
    And I open the "people" page
    Then I see "password-request-ines@acme.test"
    When I click "password-link-ines@acme.test"
    Then I see "password-link-modal"
    When I follow the link the administrator made
    Then "reset-account" says "ines@acme.test"
    When I type "a-brand-new-password" into "reset-password"
    And I click "reset-submit"
    Then I am taken to the "catalog" page
    And "ines@acme.test" can sign in with "a-brand-new-password"

  @AC-57
  Scenario: An administrator can reset somebody who never asked
    Given I am signed in as "maya@acme.test"
    When I open the "people" page
    Then I do not see "password-requests"
    When I click "person-reset-ines@acme.test"
    Then I see "password-link-modal"
    When I follow the link the administrator made
    Then "reset-account" says "ines@acme.test"

  @AC-57
  Scenario: A curator is not given anybody's password link
    Given I am signed in as "rob@acme.test"
    When I open the "people" page
    Then I see "person-maya@acme.test"
    But I do not see "person-reset-maya@acme.test"
    And I do not see "password-requests"

  @AC-58
  Scenario: The administrator of a one-person deployment lets themselves back in
    When an operator runs the console command for "maya@acme.test"
    And I follow the link it printed
    Then "reset-account" says "maya@acme.test"
    When I type "a-brand-new-password" into "reset-password"
    And I click "reset-submit"
    Then I am taken to the "catalog" page
    And "maya@acme.test" can sign in with "a-brand-new-password"

  @AC-43
  Scenario: The pages you reach without an account fit on a phone
    Given I am signed out
    When I resize the window to 390 by 844
    And I open the "forgotten password" page
    Then the page does not scroll sideways
    When I type "ines@acme.test" into "forgot-email"
    And I click "forgot-submit"
    Then I see "forgot-sent"
    And the page does not scroll sideways
