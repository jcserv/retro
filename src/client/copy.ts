import type { DiscussStatus, Phase } from "../shared/protocol";
import type { ConnectionStatus, IntentErrorCode } from "./lib/connection";
import { plural } from "./lib/format";

export const copy = {
  appName: "Retro",

  home: {
    lead: "Quick, anonymous team retros. No accounts, no setup.",
    createHeading: "Start a retro",
    createHint: "You'll run the session. Share the link with your team.",
    create: "Create room",
    creating: "Creating…",
    createErrors: {
      rate_limited: "Too many rooms created, try again in a minute.",
      failed: "Couldn't create a room. Check your connection and try again.",
    },
    or: "or",
    joinHeading: "Join a retro",
    joinCodeLabel: "Room code",
    joinCodePlaceholder: "ABC234",
    join: "Join",
    joining: "Joining…",
    invalidCode: (length: number) => `Room codes are ${length} letters and numbers.`,
    roomNotFound: "Room not found. It may have expired.",
    unreachable: "Couldn't reach the server. Try again.",
  },

  roomUnavailable: {
    not_found: {
      title: "Room not found",
      body: "This room doesn't exist or has expired. Rooms last 7 days.",
    },
    full: {
      title: "Room is full",
      body: "This room has reached its participant limit.",
    },
    backHome: "Back to home",
  },

  room: {
    documentTitle: (code: string) => `Retro · ${code}`,
    joining: "Joining room…",
    offline: "Connection lost. Reconnecting, changes are paused until then.",
  },

  header: {
    roomCode: "Room code ",
    peopleHere: (count: number) => `${plural(count, "person", "people")} here`,
    peopleHereCount: "People here: ",
    expiresInTitle: (time: string) => `Room expires in ${time}`,
    expired: "Room expired",
    expiresIn: "Expires in ",
    copyLink: "Copy link",
    copied: "Copied",
    copyFailed: "Couldn't copy",
  },

  connection: {
    connecting: "Connecting…",
    open: "Live",
    reconnecting: "Reconnecting…",
    not_found: "Room closed",
    full: "Room full",
  } satisfies Record<ConnectionStatus, string>,

  phases: {
    write: "Write",
    group: "Group",
    vote: "Vote",
    discuss: "Discuss",
    done: "Done",
  } satisfies Record<Phase, string>,

  phaseBar: {
    label: "Retro phases",
  },

  phasePlaceholder: {
    heading: (phase: string) => `${phase} phase`,
    body: "This phase is not built yet.",
  },

  ready: {
    toggle: "I'm ready",
    count: (ready: number, connected: number) => `${ready}/${connected} ready`,
  },

  owner: {
    advance: {
      write: "Start grouping",
      group: "Start voting",
      vote: "Start discussion",
      discuss: "Finish retro",
      done: null,
    } satisfies Record<Phase, string | null>,
    votesPerPerson: "Votes per person",
    votes: "Votes",
    fewerVotes: "Fewer votes per person",
    moreVotes: "More votes per person",
    votesPerPersonValue: "Votes per person: ",
  },

  timer: {
    timesUp: "Time's up",
    paused: "Paused",
    resume: "Resume timer",
    pause: "Pause timer",
    addMinuteLabel: "Add one minute",
    addMinute: "+1 min",
    clear: "Clear timer",
    menu: "Timer",
    preset: (minutes: number) => `${minutes} min`,
    customLabel: "Custom minutes",
    customPlaceholder: (min: number, max: number) => `${min}–${max}`,
    start: "Start",
  },

  errors: {
    invalid_message: "Something went wrong sending that. Try again.",
    forbidden: "Only the room owner can do that.",
    wrong_phase: "That isn't available in this phase anymore.",
    not_found: "That no longer exists.",
    too_long: "That's too long.",
    empty: "That can't be empty.",
    item_limit: "You've reached the item limit for this room.",
    vote_limit: "You're out of votes.",
    reaction_limit: "That item has too many different reactions.",
    stale: "Someone already did that.",
    rate_limited: "Slow down a little and try again.",
    disconnected: "You're offline. Reconnecting…",
    timeout: "The room didn't respond. Try again.",
  } satisfies Record<IntentErrorCode, string>,
  dismissError: "Dismiss",

  composer: {
    charactersUsed: "Characters used: ",
    cancel: "Cancel",
    save: "Save",
  },

  entry: {
    edit: "Edit",
    editLabel: (noun: string) => `Edit ${noun}`,
    delete: "Delete",
    deleteLabel: (noun: string) => `Delete ${noun}`,
    you: "You",
    edited: "edited",
  },

  write: {
    heading: "Write phase",
    lead: "Add as many thoughts as you like. Only you can see your items until grouping starts.",
    itemsWritten: (count: number, max: number) => `${count}/${max} items written`,
    totalTitle: "Items from everyone",
    total: (count: number) => plural(count, "item"),
    yourItems: (category: string) => `Your items in ${category}`,
    addItemLabel: (category: string) => `Add an item to ${category}`,
    add: "Add",
    addPlaceholder: "Add an item…",
    itemLimit: "You've reached the item limit",
    editItem: "Edit item",
    itemNoun: "item",
  },

  board: {
    itemCount: (count: number) => `${count} ${count === 1 ? "item" : "items"}`,
    inGroups: (count: number) => ` in ${count} ${count === 1 ? "group" : "groups"}`,
    noItems: "No items",
    dropToUngroup: "Drop here to ungroup",
    groupItemCount: (count: number) => `${count} items`,
    untitledGroup: "Untitled group",
    addTitle: "Add a title",
    renameGroup: ", rename group",
    groupTitle: "Group title",
    uncategorized: "Uncategorized",
    noItemsWritten: "No items were written in this retro.",
  },

  group: {
    heading: "Group similar items",
    hintFine: "Drag a card onto another to group them",
    hintCoarse: "Press and hold a card, then drag it onto another",
    hintUngroup: "Drag an item out of a group onto its column to ungroup it.",
    fallbackGroup: "group",
    fallbackItem: "item",
    merged: (source: string, target: string) => `Grouped ${source} with ${target}.`,
    moved: (item: string, group: string) => `Moved ${item} to ${group}.`,
    ungrouped: (item: string) => `Ungrouped ${item}.`,
  },

  reactions: {
    remove: "Remove your reaction",
    add: "React with this",
    addLabel: "Add reaction",
    pickerHeading: (text: string) => `React to “${text}”`,
    close: "Close",
  },

  vote: {
    heading: "Vote on what to discuss",
    hint: "Spread your votes or stack them on one topic. Totals stay hidden until discussion starts.",
    budget: (limit: number) => ` of ${limit} ${limit === 1 ? "vote" : "votes"} left`,
    remove: (title: string) => `Remove a vote from ${title}`,
    yourVotes: (title: string) => `Your votes on ${title}: `,
    add: (title: string) => `Add a vote to ${title}`,
    unit: (count: number) => (count === 1 ? "vote" : "votes"),
    count: (count: number) => `${count} ${count === 1 ? "vote" : "votes"}`,
  },

  discuss: {
    currentTopic: "Current topic",
    nothingHeading: "Nothing to discuss",
    position: (index: number, total: number) => `Topic ${index} of ${total}`,
    nowDiscussing: (position: string, label: string) => `Now discussing ${position}: ${label}`,
    previous: "Previous",
    skip: "Skip",
    next: "Next topic",
    lastTopic: "Last topic. Finish the retro when you're ready.",
    follow: "The facilitator moves everyone to the next topic.",
    agenda: "Agenda",
    agendaCurrent: "current topic",
    status: {
      pending: "Up next",
      discussed: "Discussed",
      skipped: "Skipped",
    } satisfies Record<DiscussStatus, string>,
    items: "Items",
  },

  comments: {
    heading: "Comments",
    emptyEditable: "No comments yet.",
    empty: "No comments.",
    edit: "Edit comment",
    noun: "comment",
    convertLabel: "Convert comment to action item",
    convert: "Convert to action item",
    tooLongToConvert: (max: number) => `Too long for an action item (max ${max} characters)`,
    add: "Add a comment",
    addPlaceholder: "Add a comment…",
    submit: "Comment",
  },

  actions: {
    heading: "Action items",
    emptyEditable: "No action items yet.",
    empty: "No action items.",
    assignedTo: "Assigned to ",
    due: "Due",
    edit: "Edit action item",
    editPrefix: "Edit ",
    noun: "action item",
    add: "New action item",
    addPlaceholder: "Add an action item…",
    submit: "Add action",
    assignee: "Assignee",
    assigneeLabel: (prefix: string) => `${prefix}assignee`,
    assigneePlaceholder: "Assignee (optional)",
    dueDate: "Due date",
    dueDateLabel: (prefix: string) => `${prefix}due date`,
  },

  done: {
    heading: "Retro complete",
    stats: (discussed: number, topics: number, actions: number, participants: number) =>
      `${discussed} of ${topics} ${topics === 1 ? "topic" : "topics"} discussed · ${actions} action ${actions === 1 ? "item" : "items"} · ${participants} ${participants === 1 ? "participant" : "participants"}`,
    actionsHeading: "Action items",
    noActions: "No action items were added.",
    fromTopic: "From topic ",
    discussed: "Discussed",
    notDiscussed: "Not discussed",
    topic: (position: number) => `Topic ${position}`,
    skipped: "Skipped",
  },

  exportPanel: {
    heading: "Export",
    description: "Markdown summary of this retro.",
    copy: "Copy",
    copied: "Copied",
    download: "Download .md",
    copiedFeedback: "Copied to clipboard.",
    copyFailed: "Couldn't copy. Open the preview to copy it manually.",
    preview: "Preview",
  },

  markdown: {
    none: "(none)",
    votes: (count: number) => plural(count, "vote"),
    title: (date: string) => `# Retro: ${date}`,
    subtitle: (code: string, participants: number) =>
      `Room ${code} · ${plural(participants, "participant")}`,
    discussed: "## Discussed",
    items: "- Items:",
    comments: "- Comments:",
    actions: "- Action items:",
    due: (date: string) => `due ${date}`,
    notDiscussed: "## Not discussed",
  },
};
