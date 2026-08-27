
## Per page

`copyPage` is also a frontmatter field, and it wins over the route in both
directions.

⚠️ IT EXISTS FOR THE PAGE WITH NOTHING TO COPY. A landing page that is a hero
and a row of cards has no prose behind it, so the button hands a reader a file
of headings and link text — present, working, and pointless. `copyPage: false`
in that one file is the answer, the same shape as `actions` turning the hero on
in the file that wants it. `true` turns it back on where the route turned it
off.

This site's own home page sets `false`.
