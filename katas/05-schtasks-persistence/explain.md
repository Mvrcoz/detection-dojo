# Creation is cheap; the destination is the signal

Three independent questions had to be true: *is it schtasks*, *is it creating a task*, and *does
the task run from somewhere an attacker can write*. Dropping any one of them gives you noise:

- Without the **location** test, every installer that registers a nightly job fires the rule.
- Without the **/create** test, `/query`, `/run`, `/delete` and `/change` would all match whenever
  a path appears in the command.
- Without the **image** test, any program that prints the word "schtasks" matches.

Importing a task from an XML file (`/xml`) hides the action inside the file, so the file's own
location is what you can see. Persistence through scheduled tasks is ATT&CK T1053.005.
