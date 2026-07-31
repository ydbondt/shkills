Feature: Installing, and being told the right address
  One deployment answers to several addresses: an IP and a port, a hostname
  through an ingress, a port-forward to a laptop. Whichever one somebody used
  is the one that works for them, so it is the one Shkills has to name back —
  in the command the portal shows, in the script that command downloads, and in
  the link the terminal tells them to open. Naming a different one is not a
  cosmetic slip: it is the address that machine will sync from for ever after.

  Background:
    Given these people:
      | name      | email          | role  | department  |
      | Maya Chen | maya@acme.test | admin | engineering |
    And "maya@acme.test" has published the skill "writing-style"
    And a company-wide collection "everyone" containing:
      | writing-style |

  @AC-46
  Scenario: Copying the command on a deployment that has no TLS
    Given the browser has no clipboard API, as on a plain-HTTP server
    And I am signed in as "maya@acme.test"
    When I open the "your setup" page
    And I click "copy-install-command"
    Then "copy-install-command" says "Copied"
    And the clipboard holds what "install-command" shows

  @AC-47
  Scenario: The portal offers the address you reached it on
    Given I reach the portal at "localhost"
    And I am signed in as "maya@acme.test"
    When I open the "your setup" page
    Then "install-command" says "localhost"
    And "install-command" does not say "127.0.0.1"

  @AC-47 @AC-50
  Scenario: The one command installs a CLI that talks back to the same place
    Given a machine called "fresh-laptop"
    When the machine "fresh-laptop" installs Shkills from "localhost"
    Then the command succeeds
    And the terminal says "Shkills CLI installed"
    And the machine "fresh-laptop" is pointed at "localhost"
    And a new shell on "fresh-laptop" finds the installed shkills

  @AC-47
  Scenario: The link the terminal offers is one that machine can reach
    Given a machine called "rob-laptop"
    When "maya@acme.test" links the machine "rob-laptop" from "localhost"
    Then the terminal says "Linked as Maya Chen"
    And the link it printed points at the address that machine uses
    And the machine "rob-laptop" has the skill "writing-style"

  @AC-48
  Scenario: A forged address cannot be smuggled into the script
    Then a made-up Host header cannot get into the installer

  @AC-49
  Scenario: Re-running the installer moves a machine to the new address
    Given a machine called "old-laptop"
    When the machine "old-laptop" installs Shkills from "127.0.0.1"
    Then the machine "old-laptop" is pointed at "127.0.0.1"
    When "maya@acme.test" links the machine "old-laptop"
    Then the machine "old-laptop" has the skill "writing-style"
    When the machine "old-laptop" installs Shkills from "localhost"
    Then the command succeeds
    And the machine "old-laptop" is pointed at "localhost"
    And the machine "old-laptop" is still linked
    When the machine "old-laptop" syncs
    Then the command succeeds
