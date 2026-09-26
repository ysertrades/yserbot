# Regression catalog
| ID | Symptom | Cause | Files |
|----|---------|-------|-------|
| REG-001 | Composer empty | unawaited composer.list | web/api.js, app.js |
| REG-002 | Automation no forms | templateOptions on Promise | app.js |
| REG-003 | Health NaN | key drift | web/api.js |
| REG-004 | Tabs missing | syncFeatureNav skipped | app.js, index.html |
| REG-005 | Whop late | min poll 2m | web/whop.js, whopRunner |
| REG-006 | accessibleGuilds error | broken me() | web/api.js |
| REG-007 | Fake mod cases | cleared warns counted | api counts |
| REG-008 | Mobile scroll | flex/CSS | app.css |
| REG-009 | Disabled cmd runs | no execute gate | interactionCreate |
| REG-010 | Help shows off features | no filter | help.js |
| REG-011 | Giveaway image URL-only | no upload | giveaway.js |
| REG-012 | Panel post no-op | missing writes | writes.js |
| REG-013 | Dead social posts | leftover UI | app.js |
| REG-014 | Lock/unlock toast pl.categories.map | panelLog shape flat vs {categories,values} | web/api.js, app.js |
| REG-015 | Lock/unlock multi-second lag | full guildOverview after channellock | web/server.js |
| REG-016 | /lock Chat only ≠ panel | slash offered chat mode engine maps to media | commands/moderation/lock.js |
| REG-017 | Channel select wipe / native dropdown | data-cselect opt-out + full re-render | channel-locks-ui.js |
| REG-018 | Feeds form crash after write | econcal missing weekly/impactLevels | web/api.js, app.js |
| REG-019 | Unlock shows unlocked while Discord locked | unlock deleted JSON after perm failure | utils/channelLock.js |
| REG-020 | PLACEHOLDER crash on boot | partial deploy of writes/server/app | hoster + smoke size checks |
