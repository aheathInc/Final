# Login control correction

Small incumbent Flutter Android refinement, Operate mode. User explicitly requests removing “Tumia account nyingine / sahau account hii” and replacing “Ingia kwa password” with “Ingia” plus an icon. Their instruction overrides previous switch/forget UI guidance. Preserve authentication, remembered identity, password entry, OTP recovery and the separate registration/link routes.

Primary source apps/patient-mobile/lib/screens/login_screen.dart. Use Material login_rounded icon on the primary login action, retain theme roles and existing control size. No new world, global product/design files or browser detector under the incumbent-refinement exception.

Native evidence native/login-remembered.png comes from physical Pixel 4 using the current-source isolated preview integration_test/login_label_preview.dart with synthetic secure storage and intercepted requests. Do not claim a real account session from that capture. Targeted existing login regressions verify the remembered identity still submits and the removed control is absent. Review only supplied source/capture; no edits, rendering or broad audit.
