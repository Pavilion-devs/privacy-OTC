/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/veil_otc.json`.
 */
export type VeilOtc = {
  "address": "GxWYbU37z4AcLqzfQi1WpRhGJoBZ4nf38REXR6XtZok3",
  "metadata": {
    "name": "veilOtc",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Private OTC marketplace core program for VeilOTC"
  },
  "instructions": [
    {
      "name": "closeBidding",
      "discriminator": [
        219,
        203,
        190,
        31,
        25,
        53,
        75,
        228
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true,
          "relations": [
            "listing"
          ]
        },
        {
          "name": "listing",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "completeSettlement",
      "discriminator": [
        204,
        142,
        168,
        39,
        247,
        27,
        183,
        240
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true,
          "relations": [
            "listing"
          ]
        },
        {
          "name": "listing",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "settlementReceipt",
          "type": "string"
        }
      ]
    },
    {
      "name": "createListing",
      "discriminator": [
        18,
        168,
        45,
        24,
        191,
        31,
        117,
        54
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "arg",
                "path": "seed"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "seed",
          "type": "u64"
        },
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "createListingArgs"
            }
          }
        }
      ]
    },
    {
      "name": "selectWinner",
      "discriminator": [
        119,
        66,
        44,
        236,
        79,
        158,
        82,
        51
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true,
          "relations": [
            "listing"
          ]
        },
        {
          "name": "listing",
          "writable": true
        },
        {
          "name": "bid",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "updateListing",
      "discriminator": [
        192,
        174,
        210,
        68,
        116,
        40,
        242,
        253
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true,
          "relations": [
            "listing"
          ]
        },
        {
          "name": "listing",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "updateListingArgs"
            }
          }
        }
      ]
    },
    {
      "name": "upsertBid",
      "discriminator": [
        131,
        130,
        36,
        142,
        255,
        147,
        173,
        60
      ],
      "accounts": [
        {
          "name": "bidder",
          "writable": true,
          "signer": true
        },
        {
          "name": "listing",
          "writable": true
        },
        {
          "name": "bid",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "listing"
              },
              {
                "kind": "account",
                "path": "bidder"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "upsertBidArgs"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "bid",
      "discriminator": [
        143,
        246,
        48,
        245,
        42,
        145,
        180,
        88
      ]
    },
    {
      "name": "listing",
      "discriminator": [
        218,
        32,
        50,
        73,
        43,
        134,
        26,
        58
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorizedSeller",
      "msg": "Only the listing seller can perform this action."
    },
    {
      "code": 6001,
      "name": "listingNotBidding",
      "msg": "The listing is not currently accepting bids."
    },
    {
      "code": 6002,
      "name": "listingNotInReview",
      "msg": "The listing is not currently in seller review."
    },
    {
      "code": 6003,
      "name": "listingNotSettling",
      "msg": "The listing is not currently settling."
    },
    {
      "code": 6004,
      "name": "sellerCannotBid",
      "msg": "The seller cannot bid on their own listing."
    },
    {
      "code": 6005,
      "name": "bidderNotAllowed",
      "msg": "This bidder is not allowlisted for the selected listing."
    },
    {
      "code": 6006,
      "name": "bidDoesNotBelongToListing",
      "msg": "The selected bid does not belong to this listing."
    },
    {
      "code": 6007,
      "name": "winnerNotSelected",
      "msg": "A winner must be selected before settlement can complete."
    },
    {
      "code": 6008,
      "name": "invalidAskRange",
      "msg": "Ask range is invalid."
    },
    {
      "code": 6009,
      "name": "fieldTooLong",
      "msg": "String field exceeds the maximum supported length."
    },
    {
      "code": 6010,
      "name": "allowlistTooLarge",
      "msg": "Allowlist exceeds the maximum supported size."
    },
    {
      "code": 6011,
      "name": "invalidAllocation",
      "msg": "Allocation must be between 1 and 10,000 basis points."
    }
  ],
  "types": [
    {
      "name": "bid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "bidder",
            "type": "pubkey"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "priceUsd",
            "type": "u64"
          },
          {
            "name": "allocationBps",
            "type": "u16"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "bidStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "note",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "bidStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "sealed"
          },
          {
            "name": "selected"
          }
        ]
      }
    },
    {
      "name": "createListingArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetName",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "category",
            "type": "string"
          },
          {
            "name": "settlementAsset",
            "type": "string"
          },
          {
            "name": "summary",
            "type": "string"
          },
          {
            "name": "hiddenTerms",
            "type": "string"
          },
          {
            "name": "askMinUsd",
            "type": "u64"
          },
          {
            "name": "askMaxUsd",
            "type": "u64"
          },
          {
            "name": "allowlist",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "listing",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "seed",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "askMinUsd",
            "type": "u64"
          },
          {
            "name": "askMaxUsd",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "listingStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "assetName",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "category",
            "type": "string"
          },
          {
            "name": "settlementAsset",
            "type": "string"
          },
          {
            "name": "summary",
            "type": "string"
          },
          {
            "name": "hiddenTerms",
            "type": "string"
          },
          {
            "name": "allowlist",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "winningBid",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "settlementReceipt",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "listingStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "bidding"
          },
          {
            "name": "review"
          },
          {
            "name": "settling"
          },
          {
            "name": "closed"
          }
        ]
      }
    },
    {
      "name": "updateListingArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "category",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "settlementAsset",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "summary",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "hiddenTerms",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "askMinUsd",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "askMaxUsd",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "allowlist",
            "type": {
              "option": {
                "vec": "pubkey"
              }
            }
          }
        ]
      }
    },
    {
      "name": "upsertBidArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "priceUsd",
            "type": "u64"
          },
          {
            "name": "allocationBps",
            "type": "u16"
          },
          {
            "name": "note",
            "type": "string"
          }
        ]
      }
    }
  ]
};
