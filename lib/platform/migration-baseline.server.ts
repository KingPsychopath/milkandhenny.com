/**
 * Source SQL fingerprints pinned on 2026-09-26. Rows through 0095 are a source baseline:
 * production did not store originally applied SQL hashes, so they are not proof of execution.
 * New append-only migrations are pinned here as they are committed.
 */
export const HISTORICAL_MIGRATION_SHA256 = {
  "0001_events_and_tickets": "157f3a44a1f112481cf13a1dc25e0fd8157f63bd6b050d59d73525735a830bad",
  "0002_checkout_sessions": "cfc2d86e6bf03398ac887b7a61b245825ec1da70f73bbab1c2137e7cabab8007",
  "0003_ticket_terms_acceptance":
    "c4d9a2f9d7471d3826f85225ae66bbacc96d5cf3f95cb697f9f3f08f6b207711",
  "0004_pitch_night_platform": "772e3b22d4b18768543f8c29d54974c8b0ae325b8af3b998de897630835e5c38",
  "0005_checkpoints_and_scanner_links":
    "802a976923ba88cf2e2df6eef3ae9335171485e1d737402e9a7bd6c884b0132a",
  "0006_scanner_link_devices": "939daf2030b000657c5b0de003ca365f4254fad5c50b278e115963c98717f5f7",
  "0007_scanner_roles_and_guest_requests":
    "e60c080722aee0658e60bfd14dd9a99a6c1f90a4cd400b4b96033f9568d69e57",
  "0008_scanner_link_permission_overrides":
    "e2014f738954e97052aeda0df5fed6d352296395176c7a139419a948fa58bc44",
  "0009_checkpoint_multi_scan": "268474b57853a16c5337bd7f95e2f7546502c79941a390d4a48557d6108aff6e",
  "0010_event_drops": "5d28a1f7d01b05f7d0c69fb3bc1827f946a1b3dfd4cf5a690e6c753e46362b76",
  "0011_checkout_payment_state": "8bf20936c03b248bfa00544cb1ef6a7d56089d810a9207c344bd769bb81d3567",
  "0012_email_outbox": "98ade8c126d7784165a2c54e66de573809d8e8bf6d27f32606625cf01db56ca1",
  "0013_email_delivery_feedback":
    "737793c6042a880882afbdf3f9af1a004db8faf0a3741daad21ed007ccafc0fc",
  "0014_event_hero_height": "3f30dad3a655eb8a28d14787788e038cdaef700fc47901e904f68a9d25c2bab1",
  "0015_game_night_pools": "8c9d42f2d69898802c6ae16d8869aa59e3e2a8f2bc9951c55544c179acd9fd6e",
  "0016_game_night_pool_operations":
    "ea37f4135a8f17ac729094c8c19b4a2efc67391628828eae01208aa9654986ab",
  "0017_pitch_version_history": "6c465618a331317c30a4709649d1f51684be5cae18e77375fb970de4be816c0e",
  "0018_game_pool_portable_settings":
    "c36a41a334837755366f3d96a667f7a9b1ab55d7c7bf47b7c376ec0ad8a26678",
  "0019_pitch_command_journal_editions_and_trash":
    "5639dd3d0098b116ee0965aa1bd8cf72289191c2a842e2a5f5b35e7475c52dca",
  "0020_game_pool_default_entrances":
    "b1ed3e5d691dd2217d34eefcf21209dd12aa78d59ec03ecab3d5c465a5759eae",
  "0021_pitch_media_assets": "f48ff698c56e34c09379d7480c54ce928204795731e60591a4c85c434147cbaf",
  "0022_pitch_operational_mode": "96fdd34d9c15ebc6522ad2dca3cafc8d87c0eb2c9f6865c22c3c68c349c3ce5c",
  "0023_pitch_document_media_frames":
    "3f6888628b295aa1a9579a05532933b855310b65c85dbf32feb146c3876614c7",
  "0024_pitch_media_looping": "7ad5d2798ebfa58320bb00faba87b9033efcfc5b011d33b9378391f50dee399d",
  "0025_event_hero_dimensions": "0276c0df694fd9fee0f04e9624d653e944c9e214e574ca6e0d92d3d98c039130",
  "0026_pitch_document_schema_contract":
    "19cd7d6fae75a50ae67f63d00f52e3ec8efbf2bb0b8825164d0fdf4ecdf414c2",
  "0025_site_settings_v2": "00efdf137020670b3cc46f6142c8369f2a8068a47166122dc25e363bc4e7d56f",
  "0027_pitch_reminders": "4672a2ef61c278f1609efe0f8cebdb6c4353d062a60f7b90a5f144bdb8381ea2",
  "0028_communications": "3a14eb9d0399a5bf7b75de450b9ae65c59f77e7c044a9729d4f055235fb39182",
  "0029_communication_plans_and_surveys":
    "c190bd13462ff631731210966c2ce9c9dae710c226b3d1ae480b416f5d77542f",
  "0030_game_pool_assignment_leases":
    "e07d6e29d4c10b60b4758129866cb0bac9544aff0bcc06c64ce43656583420b9",
  "0031_email_engagement": "1731350d56e43b44cacd73bee607147305703624d47c5149b29922a4ce52dfd4",
  "0032_marketing_consent": "e41afd45f86e88a594a2d759390dc684fadfd213405d60dd3a0227e4ffade535",
  "0033_marketing_consent_policy_version":
    "4fc910ab433aa78b4960775d79d0c24028a4b5e34d9f1bb28bc55d5792191c2e",
  "0034_event_scoring": "f5cfcad0fccd4bd9b8f849d695898b642fd7c727446b23b62ba26d3467bfcf94",
  "0035_event_identity_history": "24e88fdf03a8ab393280cbc8761ab3648ca3205fbf4f20bebef7aa879eaf8e2e",
  "0036_event_scoring_integrity":
    "819ea25ced546aa63dae76c6795a8365deae2d6b675530ac600dfa3780c7d50d",
  "0037_event_scoring_settlement":
    "46cd9f205c2ba418da4ef5fe345715eb338ae219c0569dfa07190235a1dbcd2e",
  "0038_official_game_result_overlay":
    "c0a6d306408f9c777469e69f8bb19761946a86368a7ba5b7eea4229571edcf9a",
  "0039_discovery_collections": "a667f9f529ce88e5aedf0e2a5fed055ea4d7d95b8188a68ec0e8f5be348947f3",
  "0040_event_scoring_public_identity":
    "7afab72228d9ebf8d19c1b5033b037a20a88fdc512635e22e0870ea489730a1a",
  "0041_event_scoring_offline_reservations":
    "209b9ec87bf4f1ed84f443eab92034e43dc76e142249930202991dd77fcd695a",
  "0042_event_scoring_anomaly_review":
    "353af6081befde5faff70b04e2ad145d002ded50f608cfc1b2e9a986111d2ac8",
  "0043_event_scoring_activity_templates":
    "bf7a6cdcbae0836386933d1e8e8642d1a193e97d046ed94097992684d117e836",
  "0044_event_scoring_operations":
    "fdfcbd43f3e50b9de338ca4c3b023f89d70d590dddd8d0dd54dbc8025d34c6d5",
  "0045_event_scoring_extended_games":
    "2ed5769aa796af0df23e11ed5e850ac7b55be95502489405c3e2ab2ad9bc4e23",
  "0046_event_participant_public_names":
    "790438389ea779eaeec5975dd73b042a33e1f3d271496d8456b2c220162af660",
  "0047_ticket_exchanges": "8361eeff8804fdd28618d15031f53eab7ce6fb14c8049749ccba4442a4f18dc8",
  "0048_repeatable_discovery_cooldowns":
    "d18649e9726ac744b91b67f2732fa398cc18ef224620306a6631194a84c864b2",
  "0049_checkout_capacity_holds":
    "8da407f8681e3f4c92255e870a6b56c0453969a53d2dadf88a5cacd4badcbea5",
  "0050_complete_event_slug_cascades":
    "ff3fbe50203aa3475447d7412bb3853be3182bc5042bf0b5b1baae30c6d4feeb",
  "0051_attendee_person_access": "68aa81e38cd5c81081221049bc07e23f7be049d983b8ff1acfa4c8fced973dc4",
  "0052_event_discovery_independence":
    "7a5c86150baa898b66bd97c5e6cfb28ebc3ad8d87c48dea5ab20d07d8f57e056",
  "0053_email_operations_ledger":
    "48e7dc2076ce81c3b7dcf53eff08e170ec980c696300ee35cce927daf39ee507",
  "0054_attendee_operations": "a5ac4e37ed08d40285f711921fc49c031d4c8cbed58f1fd3c49ad72aa1392b95",
  "0055_attendee_operations_authority":
    "036e95ab7b3f6c89adbcdb69fd90f1d566a33f5f7c791994e4050f225996bc57",
  "0056_multi_payment_ticket_refunds":
    "ec0534c8ec0633c44a973c842108c906f69f2b56e450a965455a00d0cc90564a",
  "0057_ticket_return_expiry": "53b03e02c731257283160167dfe2a50dd64951a2ba3264bd0e2918f6c78eea2f",
  "0058_attendee_identity_acquisition_status":
    "315fcf7ff43058632cf643b249258ac48707dc12857fcd27473ae5d0db51017c",
  "0059_game_pool_current_settings":
    "40594b938a7b6e8c67fb4a36097e561735e6a8c2da2cc288139e3e238e948576",
  "0060_admin_notification_read_state":
    "ba0d03be78904d20ff98359ee838f96be308355954945c565db48c3aa16fdbbb",
  "0061_person_game_history": "4f2d98d06916f77a073183c359c8f4ca8d9c1b8071b9f8b90063e8c1da364ea7",
  "0062_uuidv7_people_and_passkeys":
    "166fd16633b4caf3eb0e911488515d175c5c7d8914a13509d34443361e95f463",
  "0063_totp_and_recovery_codes":
    "3b559b4ab31c09cd42f8370ecc2cf8fcc5ad50e11855d5935b3296be12c77f43",
  "0064_person_game_solo_mode": "81b54dae24daa0a1e39b5744aff223b916dd37c91adb73f0d240edcb4326d95b",
  "0065_hot_and_cold_daily_results":
    "a3854bdca823312cf46d27860135698017eeba0a3929b40b3c843b6f79b56c5a",
  "0066_pitch_person_ownership": "a38423010877a4ccddcf80e0c414bf64ee22053fc791784aac7d2789f72de791",
  "0067_reset_hot_and_cold_daily_history":
    "97952a52e54b445e550a8fd5354fb5b5c94474aefac36099be9bc4e351436ec0",
  "0068_seed_hot_and_cold_puzzle_three":
    "6432070b9cb41b868d04e2e932261f1cb16c113fc90cfd1c52fc7ad0ea8c73bc",
  "0069_admin_ticket_invitations":
    "fbca9efdca6278520694d8cd606a9b88007b180c83f3414432a999065f116919",
  "0070_hot_and_cold_judging_revision":
    "78f59e05d35188c17885299f30349f9113d95461b0238192fc8549e10bdec37e",
  "0071_hot_and_cold_revision_replay":
    "85c2d3caf63dd796a7645f36ea6ef212d4b7845879b4c046cd08f13ff764a5f1",
  "0072_hot_and_cold_revision_identity":
    "443d07bcf16c78eb464801d20a1eefed9525a48d14bbb6dedb931b35efcd76ba",
  "0073_application_scheduled_jobs":
    "08ee103690769f5d961d53e1898249923882a93934f733d0c6176a6879e1fa18",
  "0074_family_feud_group_claims":
    "1ff959fa549da3273d1138de0a2ddc26395951fdd4d4cc0f80f33c17070e243b",
  "0075_event_waitlists": "5c2b120b1258ed07b0b2517e027e27df4b16ab2308061b9e0f77313f05c66f65",
  "0076_expiring_staff_award_claims":
    "ae3d0ae2dc44980b22694e29372c4340411e6a7eb4357061d1aca6cf5724094c",
  "0077_event_team_colours": "a6953f49a4b75bfcd70d6bd95ecd4ae70971034f8136657abb85f9201424b342",
  "0078_event_arrival_icebreaker":
    "f9260f4e54400f298984d26111299ba183e1d772055b94be584d9b271db4e84e",
  "0079_event_staff_roles": "c2ad5128cc7178fa2872bec17892b200a8a8e36cd94b123a78a1bfebc5d5d1a1",
  "0080_event_drop_schedules": "fb4be1cfbdde474d88cb201bb15414559f097c5cf060a8556e25eb302b03e4da",
  "0081_event_game_register": "4d4ad8b4ade44276e6e00cb1ee35e4771183dd7aa5ce42a01cdeb6395ee9c4b8",
  "0082_automatic_pooled_game_results":
    "ac551c44c77ac89abbba602d95baf2267136d8e98d2ef8965ac73ce106a813cc",
  "0083_event_night_schedules": "f934c8c6076296c39eaa43281468e610a5e30e16703bec63f5f646480a7fd9c2",
  "0084_event_night_schedule_source":
    "137f5a8757a21e6f56f4d4ebfb5338c5c74ca40d26a8c0f97db7a6534857069d",
  "0085_achievements": "66d3f0674913e8bd57249273cafd284ac221133c81d767a494501b94a8c3f7bc",
  "0086_waitlist_conversions": "d1229c8d86dea317bfab3e3155942d50adb9afd221936e4c9ce95c6850ed4d5a",
  "0087_after_school_feedback_questions":
    "d9beef756242ac6b309371a736dba497cc27bfeff6b0a2af29083d9d7ac4cec5",
  "0088_attendee_credits": "9a4d98c73ac15dc0cf235590b6db8e0a5ed49d4d13b830eccfc4c77887423fe6",
  "0089_attendee_credit_redemptions":
    "0732dc31de996c4c5ad4f24b51fc70dda4d783e9a6768752d0656f092fcf11a6",
  "0090_pre_event_team_assignment":
    "f6637fca38e49c36c0df6370761e23f6ca33576a354d5a780f0db8b63788e8cd",
  "0091_event_team_email": "e93e29acccb1606664bab04d99242bc176053d31f8083746d592589193dcf0b4",
  "0092_account_transfer_permissions":
    "822f724d6f2f4208b301ba4a1e1a7bbc6144d1ced2426e740b0d719fd66d0eb2",
  "0093_reusable_polls": "836dd0987736370b13f7f6c929cfee4c9f9ef208491ba261513c85d39f6df1f8",
  "0094_restore_after_school_club_practical_changes":
    "2db9a15cc7078755405ab916fae4fb79a25c1dddbe9e7bd7972d42bd72c71a32",
  "0095_intentional_survey_identity":
    "8436ef28385ca8b8593239dafae507311a13bba661ef3dbad449f8df1e948def",
  "0096_pitch_thumbnail_ownership":
    "8e3e270a20236ec696c746f2fa05807e055fd51f103657b44e834f9c96aadc36",
  "0097_ticket_event_ownership": "1a2955703882bbcf4eb748d1865cca5956414e70b08080a66acd909ec8d2cd43",
  "0098_rate_limit_windows": "c440921c3d31b9c4ae686040abd5eba0112610a9221eeefaaf5f1abed710f5bd",
  "0099_upload_access_window": "ebee61d6b09311abd73b4820decd2ecd99108e8a0f2007938a3f37b023b2fad4",
  "0100_auth_token_state": "f9a261438e2e99ca1ce016d12e38cf5019863b5b9f1c16d03df11e9d2fa8cf1d",
  "0101_attendee_sessions": "f2a06d37b4f89cac31b9d7ac98e0b6004eb1467d4b6214f7e0a5cfd5902f9464",
  "0102_cli_authorization": "a308b47b2c42dcea8c70148bf1f31a352e2422cb4ea8ec6e1f43cb8eef1c8408",
  "0103_passkey_ceremonies": "7bb99c76945d2b11b931b29383ea2024d8b9e896020f2505482468ce10f14c01",
  "0104_diagnostic_reports": "1a20fb9c1dba966016608929e27bddd433d227eccf74257dd77c4110d9d3f562",
  "0105_best_dressed": "5823b6b50670c80ee7d059f6cd425a5292fd344ae8bd703d866a797d2911e96a",
  "0106_gallery_albums": "92009dfddd60fd52293402b19f5cae9eb5679402e612e90044c0336c175d5675",
  "0107_words": "3f510f6fb1345df8d388b507598eb96b22c65a2b39b002761423d3771485367f",
  "0108_word_shares": "1dad3aead45929727c4d1233c74b07a60ad7b45a4cb9d8934b8398113335230c",
  "0109_media_object_operations":
    "c169f17dfde2fca120e3e92e566c4427141dc685bbb8040e3acd73e452183ef1",
  "0110_media_worker_instances": "a4bf89e77bbc8afee1722b7b9366a1019f83a0242f5a5895920cd1bf257a5bea",
  "0111_transfer_catalogue_and_media_jobs":
    "9a2e691878c6e8cc20c8c0ba4db244cb4e8b84e319b5b97ebbb3aa246eef6e43",
  "0112_transfer_media_import_quarantine":
    "0d65976ca55e5d8e419af6547104f5d1f95b9b833ac617896e7cfb1a2f07d85e",
  "0113_transfer_object_deletions":
    "bf0fcb3a29e570e52f944b4ee449112a5217ab9db812c6b82006e0bf7598755f",
  "0114_transfer_append_reservations":
    "e8489d0a950566aedf6c16037d9472f7decdf65af3fb2c93bd9dd65fbfc26f17",
} as const;
