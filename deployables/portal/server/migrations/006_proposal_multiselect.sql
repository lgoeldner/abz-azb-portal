-- Proposal polls use the same choice cap as person polls; existing definitions and votes stay intact.
ALTER TABLE categories DROP CONSTRAINT categories_people_choices_check;
ALTER TABLE categories ADD CONSTRAINT categories_people_choices_check CHECK(
    (kind='person' OR NOT all_people)
    AND (kind IN ('person','proposal') OR max_choices=1)
);
