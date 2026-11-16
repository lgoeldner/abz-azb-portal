export interface paths {
    "/api/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current user and CSRF token */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/consent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current consent text and version, with own acceptance time; readable before consenting */
        get: operations["getMeConsent"];
        put?: never;
        /** Accept the current consent version (409 consent_outdated for any other version); until then other API routes return 403 consent_required */
        post: operations["postMeConsent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/ballots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current viewer’s own poll submissions, one per current ballot entry including repeatable and hidden collections; never named history or other voters */
        get: operations["getMeBallots"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List collections (students: no drafts; ballot_count and participation editors only) */
        get: operations["getCategories"];
        put?: never;
        /** Create collection of any kind (admins and managers; manager creator receives a category grant atomically) */
        post: operations["postCategories"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a single-answer collection and its votes/history (admin only; 400 repeatable, 404 missing, 409 stale version) */
        delete: operations["deleteCategoriesId"];
        options?: never;
        head?: never;
        /** Update collection (admin or granted manager); ballot definitions lock after first opening, bounded poll deadlines remain editable with version and closes_at only; repeatable and ongoing fixed after creation; photo collections with active images cannot change to a non-photo kind */
        patch: operations["patchCategoriesId"];
        trace?: never;
    };
    "/api/v1/submissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List authorized submissions */
        get: operations["getSubmissions"];
        put?: never;
        /** Create idempotent contribution; multipart images only for photo collections and create atomically */
        post: operations["postSubmissions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read authorized contribution */
        get: operations["getSubmissionsId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit own pending contribution with optimistic concurrency; active images cannot move to a non-photo collection; editorial roles cannot change another author’s original */
        patch: operations["patchSubmissionsId"];
        trace?: never;
    };
    "/api/v1/submissions/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Transition contribution status */
        post: operations["postSubmissionsIdStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read contribution revision history */
        get: operations["getSubmissionsIdRevisions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}/corrections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read correction requests */
        get: operations["getSubmissionsIdCorrections"];
        put?: never;
        /** Add editorial annotation with category grant (any status), or author correction request on locked contribution */
        post: operations["postSubmissionsIdCorrections"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}/corrections/{correctionID}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resolve correction request */
        post: operations["postSubmissionsIdCorrectionsCorrectionIDResolve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Attach image to own pending contribution: photo collections, or a Steckbrief with caption naming a template slot (replaces that slot); other collection types return 400 */
        post: operations["postSubmissionsIdAttachments"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}/attachments/{attachmentID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove attachment from own pending contribution; final image in a photo collection cannot be removed */
        delete: operations["deleteSubmissionsIdAttachmentsAttachmentID"];
        options?: never;
        head?: never;
        /** Edit photo caption on own pending contribution with optimistic concurrency; 400 for Steckbrief slots */
        patch: operations["patchSubmissionsIdAttachmentsAttachmentID"];
        trace?: never;
    };
    "/api/v1/attachments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read authorized original image */
        get: operations["getAttachmentsId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/attachments/{id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read authorized image preview */
        get: operations["getAttachmentsIdPreview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export all collected contributions by default, with optional explicit status filter (editors, repeatable only) */
        get: operations["getCategoriesIdExport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/words": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Editorial anonymous original word counts and moderation, word portraits only */
        get: operations["getCategoriesIdWords"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/words/{optionID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Grant-controlled reversible word exclusion/correction/merge; originals and named history stay unchanged */
        patch: operations["patchCategoriesIdWordsOptionID"];
        trace?: never;
    };
    "/api/v1/categories/{id}/words/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Editorial CSV export of included effective words and distinct voter counts, word portraits only */
        get: operations["getCategoriesIdWordsExport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Open, close or hide a collection (admin or manager with grant; draft->open, open->closed, open/closed->draft). Expired collections cannot reopen. Hiding preserves votes/history and first opened_at; reopening keeps candidates fixed. */
        post: operations["postCategoriesIdStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/ballot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Cast a named ballot: replace current selection when one-off; append an idempotent entry when repeatable (ballot_id required) */
        put: operations["putCategoriesIdBallot"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/results": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Editorial aggregate counts (single-answer only) */
        get: operations["getCategoriesIdResults"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Admin-only named ballot history (single-answer only) */
        get: operations["getCategoriesIdAudit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/roster": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Verified cohort names */
        get: operations["getRoster"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Admin user list */
        get: operations["getAdminUsers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete user without content */
        delete: operations["deleteAdminUsersId"];
        options?: never;
        head?: never;
        /** Admin admission and grants */
        patch: operations["patchAdminUsersId"];
        trace?: never;
    };
    "/api/v1/admin/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Recent administrative audit events */
        get: operations["getAdminAudit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Backup freshness and storage */
        get: operations["getAdminStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/email-reminders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current user reminder delivery preference */
        get: operations["getMeEmailReminders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change own reminder preference; does not affect login email */
        patch: operations["patchMeEmailReminders"];
        trace?: never;
    };
    "/api/v1/admin/email/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Admin-only local quota, observed Brevo credits and worker health; never provider credentials */
        get: operations["getAdminEmailStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/email/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Admin-only versioned mail budgets and pause controls within deployment ceilings */
        patch: operations["patchAdminEmailSettings"];
        trace?: never;
    };
    "/api/v1/admin/email/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Admin-only paginated masked delivery metadata; never message bodies or login links */
        get: operations["getAdminEmailMessages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/email/messages/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Admin-only sanitized delivery attempt and event history */
        get: operations["getAdminEmailMessagesId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/email/reconcile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Admin-only rate-limited refresh of provider status and delivery events */
        post: operations["postAdminEmailReconcile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/email/reminders/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Admin-only aggregate currently eligible reminder count; never sends */
        post: operations["postAdminEmailRemindersPreview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/areas": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Bereiche with default reviewers (managers and admins) */
        get: operations["getAreas"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/areas": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a Bereich (admin) */
        post: operations["postAdminAreas"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/areas/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Rename a Bereich and replace its default reviewers; reviewers must be admitted managers/admins (admin) */
        patch: operations["patchAdminAreasId"];
        trace?: never;
    };
    "/api/v1/tickets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List tickets; finished (done and approved) only with include_finished=true */
        get: operations["getTickets"];
        put?: never;
        /** Create a ticket; area reviewers/admins may assign anyone, other managers only themselves */
        post: operations["postTickets"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tickets/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Ticket with its timeline */
        get: operations["getTicketsId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit ticket fields (assignee, area reviewers, admin); changing area, assignee, size or est_pages starts a new review round */
        patch: operations["patchTicketsId"];
        trace?: never;
    };
    "/api/v1/tickets/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Move a ticket between columns; going back to todo/in_progress starts a new review round */
        post: operations["postTicketsIdStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tickets/{id}/claim": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Claim an unassigned ticket atomically and set it in_progress */
        post: operations["postTicketsIdClaim"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tickets/{id}/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add a markdown comment */
        post: operations["postTicketsIdComments"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tickets/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Set own review vote in review/done; only binding votes make a ticket approved */
        put: operations["putTicketsIdReview"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Area: {
            /** Format: uuid */
            id: string;
            name: string;
            position: number;
            reviewers: components["schemas"]["UserRef"][];
            version: number;
        };
        AreaEdit: {
            name: string;
            reviewer_ids: string[];
            version: number;
        };
        AreaInput: {
            name: string;
            reviewer_ids: string[];
        };
        Attachment: {
            caption: string;
            filename: string;
            id: string;
            mime_type: string;
            preview_url: string;
            size_bytes: number;
            url: string;
        };
        AttachmentEdit: {
            caption: string;
            version: number;
        };
        AttachmentUpload: {
            caption?: string;
            /** Format: binary */
            file: string;
            version: number;
        };
        AuditEvent: {
            action: string;
            actor_name: string;
            /** Format: date-time */
            created_at: string;
            entity_id: string;
            id: string;
        };
        BallotAudit: {
            /** @description Groups the complete selection from one ballot change. Null for legacy single-choice history. */
            ballot_id: null | string;
            /** Format: date-time */
            created_at: string;
            option_id: string;
            option_label: string;
            user_id: string;
            user_name: string;
        };
        BallotInput: {
            /**
             * Format: uuid
             * @description Client-generated key required for repeatable ballots; replay with the same selection returns success without an extra entry, changed selection conflicts.
             */
            ballot_id?: string;
            option_id?: string;
            option_ids?: string[];
            words?: string[];
        } & (unknown | unknown | unknown);
        BallotReceipt: {
            /**
             * Format: uuid
             * @description Client-generated key required for repeatable ballots; replay with the same selection returns success without an extra entry, changed selection conflicts.
             */
            ballot_id?: string;
            option_id: string;
            option_ids: string[];
            words?: string[];
        };
        Category: {
            /** @description Person polls only: all admitted cohort members, refreshed when opening and fixed thereafter. Existing polls retain explicit candidates. */
            all_people: boolean;
            allow_self_vote: boolean;
            /** @description Number of distinct current voters. Editors only; null for students and contribution categories. */
            ballot_count: null | number;
            /**
             * Format: date-time
             * @description Automatic closing instant for bounded collections; null when ongoing. Open collections are effectively closed at this instant.
             */
            closes_at: null | string;
            /** Format: date-time */
            created_at: string;
            description: string;
            id: string;
            /** @enum {string} */
            kind: "idea" | "quote" | "memory" | "photo" | "steckbrief" | "person" | "proposal" | "words";
            /** @description Maximum selections for person/proposal polls or words per voter for word portraits (1–500). Word portraits default to 3, other polls to 1; contribution kinds require 1. */
            max_choices: number;
            /** @description First current selection in canonical ID order (legacy compatibility), or null. */
            my_option_id: null | string;
            /** @description Viewer’s complete current selection; empty for contribution categories or before voting. */
            my_option_ids: string[];
            /** @description Only the viewer’s current original normalized words, empty for other kinds or before voting. Originals are unchanged by editorial moderation. */
            my_words?: string[];
            name: string;
            /** @description No scheduled closing when true (default); false requires a future closes_at. Stored independently of content kind and repeatability. */
            ongoing: boolean;
            /**
             * Format: date-time
             * @description Set once when a single-answer category moves from draft to open; creation time for repeatable ones.
             */
            opened_at: null | string;
            /** @description Empty for contribution kinds, word portraits, and all_people person poll input; otherwise explicit voting options. Word portrait responses never expose other voters’ words. */
            options: components["schemas"]["PollOption"][];
            /** @description Current voting participation among admitted cohort members, regardless of role. Both counts use the same population and database snapshot. Editors only; null for students and contribution categories. Preserved ballots from people no longer eligible are excluded here but remain in ballot_count. */
            participation: components["schemas"]["VotingParticipation"] | null;
            /** @description Allow multiple contributions or independent ballot entries per person, independently of kind. False ballots retain one changeable current selection. */
            repeatable: boolean;
            /**
             * @description All kinds support draft, open and closed; the closing deadline also makes open collections effectively closed. Draft means hidden from students, including previously opened polls; opened_at distinguishes editable new drafts from locked hidden polls.
             * @enum {string}
             */
            status: "draft" | "open" | "closed";
            /**
             * @description Steckbrief collections only: which hardcoded Steckbrief form this collection uses, fixed after creation. Empty for every other kind.
             * @enum {string}
             */
            template?: "" | "standard";
            version: number;
        };
        CategoryEdit: {
            /** @description Person polls: all admitted cohort members instead of explicit options. Defaults true on creation; omission preserves mode on edit. Other kinds require false. */
            all_people?: boolean;
            allow_self_vote?: boolean;
            /**
             * Format: date-time
             * @description Future closing instant. For existing bounded polls, a sparse request containing only version and closes_at changes the deadline in any lifecycle state without changing definitions, votes, history or stored status. Omitted deadlines are preserved exactly; contribution deadlines remain fixed. Extending an expired stored-open poll makes it open again; manually closed or hidden polls stay closed or hidden.
             */
            closes_at?: null | string;
            description?: string;
            /** @enum {string} */
            kind?: "idea" | "quote" | "memory" | "photo" | "steckbrief" | "person" | "proposal" | "words";
            /** @description Maximum selections for person/proposal polls or words per voter for word portraits (1–500). Word portraits default to 3, other polls to 1; contribution kinds require 1. */
            max_choices?: number;
            name?: string;
            /** @description No scheduled closing when true (default); false requires a future closes_at. Stored independently of content kind and repeatability. */
            ongoing?: boolean;
            /** @description Empty for contribution kinds, word portraits, and all_people person poll input; otherwise explicit voting options. Word portrait responses never expose other voters’ words. */
            options?: components["schemas"]["CategoryOption"][];
            /** @description Allow multiple contributions per person independently of kind. Omission defaults from kind on create and preserves the stored flag on edit. */
            repeatable?: boolean;
            /**
             * @description Fixed after creation: omitted preserves the stored value, a different value is rejected.
             * @enum {string}
             */
            template?: "" | "standard";
            version: number;
        } & (unknown | unknown);
        CategoryInput: {
            /** @description Person polls: all admitted cohort members instead of explicit options. Defaults true on creation; omission preserves mode on edit. Other kinds require false. */
            all_people?: boolean;
            allow_self_vote?: boolean;
            /**
             * Format: date-time
             * @description Automatic closing instant for bounded collections; null when ongoing. Open collections are effectively closed at this instant.
             */
            closes_at?: null | string;
            description: string;
            /** @enum {string} */
            kind: "idea" | "quote" | "memory" | "photo" | "steckbrief" | "person" | "proposal" | "words";
            /** @description Maximum selections for person/proposal polls or words per voter for word portraits (1–500). Word portraits default to 3, other polls to 1; contribution kinds require 1. */
            max_choices?: number;
            name: string;
            /** @description No scheduled closing when true (default); false requires a future closes_at. Stored independently of content kind and repeatability. */
            ongoing?: boolean;
            /** @description Empty for contribution kinds, word portraits, and all_people person poll input; otherwise explicit voting options. Word portrait responses never expose other voters’ words. */
            options?: components["schemas"]["CategoryOption"][];
            /** @description Allow multiple contributions per person independently of kind. Omission defaults from kind on create and preserves the stored flag on edit. */
            repeatable?: boolean;
            /**
             * @description Steckbrief collections only; defaults to standard on creation and is fixed afterwards. Other kinds require it empty or omitted.
             * @enum {string}
             */
            template?: "" | "standard";
        };
        CategoryOption: {
            label: string;
            user_id?: string;
        };
        CategoryStatusInput: {
            /** @enum {string} */
            status: "draft" | "open" | "closed";
            version: number;
        };
        CommentInput: {
            body: string;
        };
        Consent: {
            /** Format: date-time */
            accepted_at: null | string;
            draft: boolean;
            text: string[];
            version: string;
        };
        ConsentInput: {
            version: string;
        };
        Correction: {
            author_name: string;
            body: string;
            /** Format: date-time */
            created_at: string;
            id: string;
            resolved: boolean;
            submission_id: string;
        };
        EmailHealth: {
            failed: number;
            /** Format: date-time */
            last_worker_run: null | string;
            pending: number;
        };
        EmailMessage: {
            attempts: number;
            /** Format: date-time */
            created_at: string;
            failure_code: null | string;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "login" | "reminder";
            provider_message_id: null | string;
            recipient_masked: string;
            /** @enum {string} */
            status: "queued" | "accepted" | "delivered" | "deferred" | "bounced" | "failed" | "suppressed" | "cancelled" | "unknown";
            /** Format: uuid */
            user_id: null | string;
            user_name: null | string;
        };
        EmailMessageDetail: {
            events: components["schemas"]["EmailMessageEvent"][];
            message: components["schemas"]["EmailMessage"];
        };
        EmailMessageEvent: {
            /** Format: date-time */
            created_at: string;
            failure_code: null | string;
            /** Format: uuid */
            id: string;
            status: string;
        };
        EmailMessages: {
            items: components["schemas"]["EmailMessage"][];
            next_cursor: null | string;
        };
        EmailPolicy: {
            daily_limit: number;
            login_reserve: number;
            pause_all: boolean;
            paused: boolean;
            reminder_limit: number;
            version: number;
        };
        EmailProvider: {
            configured: boolean;
            credits: null | number;
            error: null | string;
            name: string;
            /** Format: date-time */
            observed_at: null | string;
        };
        EmailStatus: {
            health: components["schemas"]["EmailHealth"];
            policy: components["schemas"]["EmailPolicy"];
            provider: components["schemas"]["EmailProvider"];
            usage: components["schemas"]["EmailUsage"];
        };
        EmailUsage: {
            /** Format: date */
            day: string;
            login: number;
            remaining: number;
            reminder: number;
            reserved: number;
            used: number;
        };
        Error: {
            error: components["schemas"]["ErrorBody"];
        };
        ErrorBody: {
            code: string;
            message: string;
        };
        Me: {
            consent_required: boolean;
            csrf_token: string;
            user: components["schemas"]["User"];
        };
        MyBallot: {
            category_id: string;
            /** @enum {string} */
            category_kind: "person" | "proposal" | "words";
            category_name: string;
            /**
             * @description Effective collection status; draft entries are displayed without a collection link.
             * @enum {string}
             */
            category_status: "draft" | "open" | "closed";
            /**
             * Format: date-time
             * @description Latest timestamp of this current ballot entry.
             */
            created_at: string;
            /** @description Ballot entry key, grouped across all selected options or words. */
            id: string;
        };
        PollOption: {
            id: string;
            label: string;
            user_id?: string;
        };
        PollResult: {
            count: number;
            label: string;
            option_id: string;
        };
        ReminderPreference: {
            enabled: boolean;
        };
        ReminderPreview: {
            eligible: number;
        };
        ReviewInput: {
            /** @description The ticket round the voter saw; a different current round returns 409 so stale votes never count in a new round. */
            round: number;
            self_confirmed?: boolean;
            /** @enum {string} */
            verdict: "approve" | "changes";
        };
        Revision: {
            actor_name: string;
            attachments: components["schemas"]["Attachment"][];
            body: string;
            context: string;
            /** Format: date-time */
            created_at: string;
            id: string;
            /** @enum {string} */
            status: "pending" | "accepted" | "rejected" | "withdrawn";
            title: string;
            version: number;
        };
        RosterEntry: {
            id: string;
            name: string;
        };
        StatusInput: {
            /** @enum {string} */
            status: "pending" | "accepted" | "rejected" | "withdrawn";
            version: number;
        };
        Submission: {
            attachments: components["schemas"]["Attachment"][];
            author_id: string;
            author_name: string;
            body: string;
            category_id: string;
            context: string;
            /** Format: date-time */
            created_at: string;
            id: string;
            /** @enum {string} */
            status: "pending" | "accepted" | "rejected" | "withdrawn";
            title: string;
            /** Format: date-time */
            updated_at: string;
            version: number;
        };
        SubmissionEdit: {
            body: string;
            category_id: string;
            context: string;
            title: string;
            version: number;
        };
        SubmissionInput: {
            body: string;
            category_id: string;
            context: string;
            idempotency_key: string;
            title: string;
        };
        SubmissionUpload: {
            body?: string;
            caption?: string;
            category_id: string;
            context?: string;
            /** Format: binary */
            file: string;
            idempotency_key: string;
            /** @description Defaults to filename when omitted */
            title?: string;
        };
        SystemStatus: {
            /** Format: date-time */
            backup_last_success: null | string;
            backup_stale: boolean;
            upload_bytes: number;
        };
        Ticket: {
            /** @description True when the current round has a binding approval by a still admitted editor. Derived, never client-written. */
            approved: boolean;
            /** Format: uuid */
            area_id: string;
            area_name: string;
            assignee: components["schemas"]["UserRef"] | null;
            body: string;
            /** Format: date-time */
            created_at: string;
            created_by: components["schemas"]["UserRef"];
            est_pages: null | number;
            goal: string;
            /** Format: uuid */
            id: string;
            number: number;
            /** @description Votes of the current round. */
            reviews: components["schemas"]["TicketReview"][];
            round: number;
            /** @enum {string} */
            size: "XS" | "S" | "M" | "L" | "XL";
            /** @enum {string} */
            status: "todo" | "in_progress" | "review" | "done";
            /** Format: date-time */
            status_changed_at: string;
            title: string;
            /** @enum {string} */
            type: "aufgabe" | "artikel";
            /** Format: date-time */
            updated_at: string;
            version: number;
        };
        TicketDetail: {
            events: components["schemas"]["TicketEvent"][];
            ticket: components["schemas"]["Ticket"];
        };
        TicketEdit: {
            /** Format: uuid */
            area_id: string;
            /** Format: uuid */
            assignee_id: null | string;
            body: string;
            est_pages: null | number;
            goal: string;
            /** @enum {string} */
            size: "XS" | "S" | "M" | "L" | "XL";
            title: string;
            version: number;
        };
        TicketEvent: {
            actor: components["schemas"]["UserRef"];
            body: string;
            /** Format: date-time */
            created_at: string;
            detail: string;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "comment" | "status" | "assign" | "review" | "edit";
        };
        TicketInput: {
            /** Format: uuid */
            area_id: string;
            /** Format: uuid */
            assignee_id: null | string;
            body: string;
            est_pages: null | number;
            goal: string;
            /** @enum {string} */
            size: "XS" | "S" | "M" | "L" | "XL";
            title: string;
            /** @enum {string} */
            type: "aufgabe" | "artikel";
        };
        TicketReview: {
            binding: boolean;
            self_confirmed: boolean;
            /** Format: date-time */
            updated_at: string;
            user: components["schemas"]["UserRef"];
            /** @enum {string} */
            verdict: "approve" | "changes";
        };
        TicketStatusInput: {
            /** @enum {string} */
            status: "todo" | "in_progress" | "review" | "done";
            version: number;
        };
        User: {
            admitted: boolean;
            category_ids: string[];
            cohort_member: boolean;
            /** Format: date-time */
            created_at: string;
            id: string;
            name: string;
            /** @enum {string} */
            role: "student" | "manager" | "admin";
        };
        UserEdit: {
            admitted: boolean;
            category_ids: string[];
            cohort_member: boolean;
            name: string;
            /** @enum {string} */
            role: "student" | "manager" | "admin";
        };
        UserRef: {
            /** Format: uuid */
            id: string;
            name: string;
        };
        VersionInput: {
            version: number;
        };
        VotingParticipation: {
            /** @description All currently admitted cohort members. */
            eligible: number;
            /** @description Currently eligible people with a current ballot in this collection. */
            voted: number;
        };
        /** @description Editorial anonymous original-word tally and reversible moderation; contains no voter identity. Equal effective labels merge, counting each current voter once in results. */
        WordEntry: {
            count: number;
            excluded: boolean;
            /** @description One Unicode NFC lowercase word without whitespace or control characters; normalized on input. */
            label: string;
            option_id: string;
            version: number;
            /** @description One Unicode NFC lowercase word without whitespace or control characters; normalized on input. */
            word: string;
        };
        WordModerationInput: {
            excluded: boolean;
            /** @description One Unicode NFC lowercase word without whitespace or control characters; normalized on input. */
            label: string;
            version: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getMeConsent: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Consent"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postMeConsent: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConsentInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Consent"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getMeBallots: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyBallot"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getCategories: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postCategories: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryInput"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteCategoriesId: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VersionInput"];
            };
        };
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchCategoriesId: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryEdit"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSubmissions: {
        parameters: {
            query?: {
                category_id?: string;
                q?: string;
                status?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postSubmissions: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmissionInput"];
                "multipart/form-data": components["schemas"]["SubmissionUpload"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSubmissionsId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchSubmissionsId: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmissionEdit"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postSubmissionsIdStatus: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StatusInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSubmissionsIdRevisions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Revision"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSubmissionsIdCorrections: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Correction"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postSubmissionsIdCorrections: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CommentInput"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Correction"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postSubmissionsIdCorrectionsCorrectionIDResolve: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
                correctionID: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Correction"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postSubmissionsIdAttachments: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["AttachmentUpload"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteSubmissionsIdAttachmentsAttachmentID: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
                attachmentID: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VersionInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchSubmissionsIdAttachmentsAttachmentID: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
                attachmentID: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AttachmentEdit"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Submission"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAttachmentsId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAttachmentsIdPreview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getCategoriesIdExport: {
        parameters: {
            query?: {
                status?: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/zip": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getCategoriesIdWords: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WordEntry"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchCategoriesIdWordsOptionID: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
                optionID: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WordModerationInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WordEntry"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getCategoriesIdWordsExport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postCategoriesIdStatus: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryStatusInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putCategoriesIdBallot: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BallotInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BallotReceipt"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getCategoriesIdResults: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PollResult"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getCategoriesIdAudit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BallotAudit"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getRoster: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RosterEntry"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAdminUsers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteAdminUsersId: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchAdminUsersId: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserEdit"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAdminAudit: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEvent"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAdminStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemStatus"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getMeEmailReminders: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReminderPreference"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchMeEmailReminders: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReminderPreference"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReminderPreference"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAdminEmailStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EmailStatus"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchAdminEmailSettings: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmailPolicy"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EmailStatus"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAdminEmailMessages: {
        parameters: {
            query?: {
                cursor?: string;
                from?: string;
                kind?: "login" | "reminder";
                status?: string;
                to?: string;
                user_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EmailMessages"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAdminEmailMessagesId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EmailMessageDetail"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postAdminEmailReconcile: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EmailStatus"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postAdminEmailRemindersPreview: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReminderPreview"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAreas: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Area"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postAdminAreas: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AreaInput"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Area"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchAdminAreasId: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AreaEdit"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Area"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getTickets: {
        parameters: {
            query?: {
                area?: string;
                assignee?: string;
                include_finished?: string;
                q?: string;
                type?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ticket"][];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postTickets: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TicketInput"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ticket"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getTicketsId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TicketDetail"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchTicketsId: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TicketEdit"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ticket"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postTicketsIdStatus: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TicketStatusInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ticket"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postTicketsIdClaim: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ticket"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    postTicketsIdComments: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CommentInput"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TicketEvent"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    putTicketsIdReview: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ticket"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
}
