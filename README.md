# SillyTavern - WorldInfo Info

Forked from the amazing LenAnderson. Original at https://github.com/LenAnderson/SillyTavern-WorldInfoInfo; this version adds the following features:


Click the book in the lower left corner of the screen to see the list of active entries. 

![list of entries](https://github.com/aikohanasaki/imagehost/blob/main/wii-list.png)

The floating book icon can be dragged to a different location (right-click to enable dragging). To reset its position, use `/wi-position-reset`.
![drag-to-move](https://github.com/aikohanasaki/imagehost/blob/main/wii-dragtomove.png)

Just click an item to go to the entry in the lorebook.

🆕 `/wi-report` shows you what keywords triggered which entry during which round of recursion.

![Popup showing /wi-report](https://github.com/aikohanasaki/imagehost/blob/main/worldinfo.png)

Visibility and privacy
- Entries from hidden lorebooks are omitted from /wi-report for non-admin users.
- All counts in the report (summary and per-loop) reflect only visible entries.

![hidden lorebook](https://github.com/aikohanasaki/imagehost/blob/main/wii-listwithhide.png)

![report omits hidden books](https://github.com/aikohanasaki/imagehost/blob/main/wii-hiddenreport.png)

## Optional Lorebook Library integration

Right-click the floating book button (or long-press on mobile) and enable **로어북 서가 연동** (Link Lorebook Library). It is off by default.

When enabled and Ambasa's Lorebook Manager v1.4.85-ambasa.65 or later is running, clicking an injected lore entry opens the exact lorebook and UID in the independent floating Lorebook Library. Matching uses book name and UID, not a possibly duplicated/translated title. If the manager is absent, disabled, incompatible, or cannot open that entry, the existing WorldInfo Info read-only floating viewer opens instead.

This option changes only on-click navigation: no lorebook, translation, activation or generation data is written. The original floating viewer continues to show activation explanations when used.
## License

This project is licensed under the GNU Affero General Public License v3.0. See [LICENSE](./LICENSE).