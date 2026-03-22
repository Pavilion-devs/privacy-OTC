use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::{CreatePermissionCpiBuilder, DelegatePermissionCpiBuilder},
        structs::{
            Member, MembersArgs, Permission, ACCOUNT_SIGNATURES_FLAG, AUTHORITY_FLAG,
            TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    consts::PERMISSION_PROGRAM_ID,
    cpi::{delegate_account, DelegateAccounts, DelegateConfig, DELEGATION_PROGRAM_ID},
};

declare_id!("GxWYbU37z4AcLqzfQi1WpRhGJoBZ4nf38REXR6XtZok3");

const MAX_ASSET_NAME_LEN: usize = 48;
const MAX_SYMBOL_LEN: usize = 12;
const MAX_CATEGORY_LEN: usize = 32;
const MAX_SETTLEMENT_ASSET_LEN: usize = 12;
const MAX_SUMMARY_LEN: usize = 160;
const MAX_HIDDEN_TERMS_LEN: usize = 256;
const MAX_NOTE_LEN: usize = 160;
const MAX_RECEIPT_LEN: usize = 160;
const MAX_ALLOWLIST_LEN: usize = 16;
const VIEWER_FLAGS: u8 =
    ACCOUNT_SIGNATURES_FLAG | TX_LOGS_FLAG | TX_BALANCES_FLAG | TX_MESSAGE_FLAG;
const LISTING_PRIVATE_SEED: &[u8] = b"listing-private";
const BID_PRIVATE_SEED: &[u8] = b"bid-private";

#[program]
pub mod veil_otc {
    use super::*;

    pub fn create_listing(
        ctx: Context<CreateListing>,
        seed: u64,
        args: CreateListingArgs,
    ) -> Result<()> {
        validate_listing_args(&args)?;

        let CreateListingArgs {
            asset_name,
            symbol,
            category,
            settlement_asset,
            summary,
            ask_min_usd,
            ask_max_usd,
            allowlist,
        } = args;
        let normalized_allowlist = normalize_allowlist(allowlist);
        let listing_shell = &mut ctx.accounts.listing_shell;
        let listing_private = &mut ctx.accounts.listing_private;
        let clock = Clock::get()?;

        listing_shell.seller = ctx.accounts.seller.key();
        listing_shell.seed = seed;
        listing_shell.created_at = clock.unix_timestamp;
        listing_shell.updated_at = clock.unix_timestamp;
        listing_shell.ask_min_usd = ask_min_usd;
        listing_shell.ask_max_usd = ask_max_usd;
        listing_shell.status = ListingStatus::Bidding;
        listing_shell.bump = ctx.bumps.listing_shell;
        listing_shell.asset_name = asset_name;
        listing_shell.symbol = symbol;
        listing_shell.category = category;
        listing_shell.settlement_asset = settlement_asset;
        listing_shell.summary = summary;
        listing_shell.allowlist = normalized_allowlist.clone();
        listing_shell.private_details = listing_private.key();
        listing_shell.winning_bid = None;
        listing_shell.settlement_receipt = String::new();

        listing_private.listing_shell = listing_shell.key();
        listing_private.seller = ctx.accounts.seller.key();
        listing_private.created_at = clock.unix_timestamp;
        listing_private.updated_at = clock.unix_timestamp;
        listing_private.hidden_terms = String::new();

        let listing_shell_key = listing_shell.key();
        let listing_private_bump = [ctx.bumps.listing_private];
        let listing_private_signer_seeds: &[&[&[u8]]] = &[&[
            LISTING_PRIVATE_SEED,
            listing_shell_key.as_ref(),
            &listing_private_bump,
        ]];

        create_permission_for_account(
            &ctx.accounts.permission_program.to_account_info(),
            &ctx.accounts.listing_private.to_account_info(),
            &ctx.accounts.listing_private_permission.to_account_info(),
            &ctx.accounts.seller.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            build_listing_members(ctx.accounts.seller.key(), &normalized_allowlist),
            listing_private_signer_seeds,
        )?;

        Ok(())
    }

    pub fn delegate_listing_private(ctx: Context<DelegateListingPrivate>) -> Result<()> {
        let listing_shell_key = ctx.accounts.listing_shell.key();
        let listing_private_seeds: &[&[u8]] = &[LISTING_PRIVATE_SEED, listing_shell_key.as_ref()];

        delegate_private_account(
            &ctx.accounts.seller.to_account_info(),
            &ctx.accounts.private_details.to_account_info(),
            &ctx.accounts.veil_otc_program.to_account_info(),
            &ctx.accounts.private_details_delegate_buffer.to_account_info(),
            &ctx.accounts.private_details_delegation_record.to_account_info(),
            &ctx.accounts.private_details_delegation_metadata.to_account_info(),
            &ctx.accounts.delegation_program.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            listing_private_seeds,
            &ctx.accounts.validator.to_account_info(),
        )?;

        delegate_permission_for_account(
            &ctx.accounts.permission_program.to_account_info(),
            &ctx.accounts.seller.to_account_info(),
            &ctx.accounts.private_details.to_account_info(),
            &ctx.accounts.listing_private_permission.to_account_info(),
            &ctx.accounts.private_permission_delegate_buffer.to_account_info(),
            &ctx.accounts.private_permission_delegation_record.to_account_info(),
            &ctx.accounts.private_permission_delegation_metadata.to_account_info(),
            &ctx.accounts.delegation_program.to_account_info(),
            &ctx.accounts.validator.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
        )?;

        Ok(())
    }

    pub fn update_listing_private(
        ctx: Context<UpdateListingPrivate>,
        hidden_terms: String,
    ) -> Result<()> {
        validate_hidden_terms(&hidden_terms)?;

        let listing_private = &mut ctx.accounts.private_details;
        listing_private.hidden_terms = hidden_terms;
        listing_private.updated_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn create_bid(ctx: Context<CreateBid>) -> Result<()> {
        let listing_shell = &ctx.accounts.listing_shell;
        require!(
            listing_shell.status == ListingStatus::Bidding,
            VeilOtcError::ListingNotBidding
        );
        require!(
            listing_shell.seller != ctx.accounts.bidder.key(),
            VeilOtcError::SellerCannotBid
        );
        require!(
            is_allowlisted(&listing_shell.allowlist, &ctx.accounts.bidder.key()),
            VeilOtcError::BidderNotAllowed
        );

        let bid_shell = &mut ctx.accounts.bid_shell;
        let bid_private = &mut ctx.accounts.bid_private;
        let clock = Clock::get()?;

        bid_shell.listing_shell = listing_shell.key();
        bid_shell.bidder = ctx.accounts.bidder.key();
        bid_shell.private_details = bid_private.key();
        bid_shell.created_at = clock.unix_timestamp;
        bid_shell.updated_at = clock.unix_timestamp;
        bid_shell.status = BidStatus::Sealed;
        bid_shell.bump = ctx.bumps.bid_shell;

        bid_private.listing_shell = listing_shell.key();
        bid_private.bid_shell = bid_shell.key();
        bid_private.bidder = ctx.accounts.bidder.key();
        bid_private.created_at = clock.unix_timestamp;
        bid_private.updated_at = clock.unix_timestamp;
        bid_private.price_usd = 0;
        bid_private.allocation_bps = 0;
        bid_private.note = String::new();

        let bid_shell_key = bid_shell.key();
        let bid_private_bump = [ctx.bumps.bid_private];
        let bid_private_signer_seeds: &[&[&[u8]]] =
            &[&[BID_PRIVATE_SEED, bid_shell_key.as_ref(), &bid_private_bump]];

        create_permission_for_account(
            &ctx.accounts.permission_program.to_account_info(),
            &ctx.accounts.bid_private.to_account_info(),
            &ctx.accounts.bid_private_permission.to_account_info(),
            &ctx.accounts.bidder.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            build_bid_members(ctx.accounts.bidder.key(), listing_shell.seller),
            bid_private_signer_seeds,
        )?;

        Ok(())
    }

    pub fn delegate_bid_private(ctx: Context<DelegateBidPrivate>) -> Result<()> {
        let bid_shell_key = ctx.accounts.bid_shell.key();
        let bid_private_seeds: &[&[u8]] = &[BID_PRIVATE_SEED, bid_shell_key.as_ref()];

        delegate_private_account(
            &ctx.accounts.bidder.to_account_info(),
            &ctx.accounts.private_details.to_account_info(),
            &ctx.accounts.veil_otc_program.to_account_info(),
            &ctx.accounts.private_details_delegate_buffer.to_account_info(),
            &ctx.accounts.private_details_delegation_record.to_account_info(),
            &ctx.accounts.private_details_delegation_metadata.to_account_info(),
            &ctx.accounts.delegation_program.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            bid_private_seeds,
            &ctx.accounts.validator.to_account_info(),
        )?;

        delegate_permission_for_account(
            &ctx.accounts.permission_program.to_account_info(),
            &ctx.accounts.bidder.to_account_info(),
            &ctx.accounts.private_details.to_account_info(),
            &ctx.accounts.bid_private_permission.to_account_info(),
            &ctx.accounts.private_permission_delegate_buffer.to_account_info(),
            &ctx.accounts.private_permission_delegation_record.to_account_info(),
            &ctx.accounts.private_permission_delegation_metadata.to_account_info(),
            &ctx.accounts.delegation_program.to_account_info(),
            &ctx.accounts.validator.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
        )?;

        Ok(())
    }

    pub fn update_bid_private(
        ctx: Context<UpdateBidPrivate>,
        args: UpdateBidPrivateArgs,
    ) -> Result<()> {
        validate_bid_args(&args)?;

        let listing_shell = &ctx.accounts.listing_shell;
        require!(
            listing_shell.status == ListingStatus::Bidding,
            VeilOtcError::ListingNotBidding
        );

        let bid_private = &mut ctx.accounts.private_details;
        let clock = Clock::get()?;

        bid_private.price_usd = args.price_usd;
        bid_private.allocation_bps = args.allocation_bps;
        bid_private.note = args.note;
        bid_private.updated_at = clock.unix_timestamp;

        Ok(())
    }

    pub fn close_bidding(ctx: Context<ManageListing>) -> Result<()> {
        let listing_shell = &mut ctx.accounts.listing_shell;
        require!(
            listing_shell.status == ListingStatus::Bidding,
            VeilOtcError::ListingNotBidding
        );

        listing_shell.status = ListingStatus::Review;
        listing_shell.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn select_winner(ctx: Context<SelectWinner>) -> Result<()> {
        let listing_shell = &mut ctx.accounts.listing_shell;
        let bid_shell = &mut ctx.accounts.bid_shell;

        require!(
            listing_shell.status == ListingStatus::Review,
            VeilOtcError::ListingNotInReview
        );
        require!(
            bid_shell.listing_shell == listing_shell.key(),
            VeilOtcError::BidDoesNotBelongToListing
        );

        listing_shell.status = ListingStatus::Settling;
        listing_shell.winning_bid = Some(bid_shell.key());
        listing_shell.updated_at = Clock::get()?.unix_timestamp;
        bid_shell.status = BidStatus::Selected;
        bid_shell.updated_at = listing_shell.updated_at;

        Ok(())
    }

    pub fn complete_settlement(
        ctx: Context<ManageListing>,
        settlement_receipt: String,
    ) -> Result<()> {
        validate_receipt(&settlement_receipt)?;

        let listing_shell = &mut ctx.accounts.listing_shell;
        require!(
            listing_shell.status == ListingStatus::Settling,
            VeilOtcError::ListingNotSettling
        );
        require!(
            listing_shell.winning_bid.is_some(),
            VeilOtcError::WinnerNotSelected
        );

        listing_shell.status = ListingStatus::Closed;
        listing_shell.settlement_receipt = settlement_receipt;
        listing_shell.updated_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn archive_listing(ctx: Context<ManageListing>) -> Result<()> {
        let listing_shell = &mut ctx.accounts.listing_shell;
        require!(
            listing_shell.status == ListingStatus::Closed,
            VeilOtcError::ListingNotClosed
        );

        listing_shell.status = ListingStatus::Archived;
        listing_shell.updated_at = Clock::get()?.unix_timestamp;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct CreateListing<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        init,
        payer = seller,
        space = 8 + ListingShell::INIT_SPACE,
        seeds = [b"listing", seller.key().as_ref(), &seed.to_le_bytes()],
        bump
    )]
    pub listing_shell: Account<'info, ListingShell>,
    #[account(
        init,
        payer = seller,
        space = 8 + ListingPrivate::INIT_SPACE,
        seeds = [LISTING_PRIVATE_SEED, listing_shell.key().as_ref()],
        bump
    )]
    pub listing_private: Account<'info, ListingPrivate>,
    /// CHECK: Permission PDA is derived from the private account key.
    #[account(
        mut,
        constraint = listing_private_permission.key() == permission_pda(&listing_private.key())
            @ VeilOtcError::InvalidPermissionAccount
    )]
    pub listing_private_permission: UncheckedAccount<'info>,
    /// CHECK: Program address is pinned to the MagicBlock permission program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateListingPrivate<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        mut,
        has_one = seller @ VeilOtcError::UnauthorizedSeller,
        has_one = private_details @ VeilOtcError::InvalidPrivateAccount
    )]
    pub listing_shell: Account<'info, ListingShell>,
    /// CHECK: The PDA is derived from the listing shell and is delegated in this instruction.
    #[account(
        mut,
        seeds = [LISTING_PRIVATE_SEED, listing_shell.key().as_ref()],
        bump
    )]
    pub private_details: UncheckedAccount<'info>,
    /// CHECK: Permission PDA is derived from the private account key.
    #[account(
        mut,
        constraint = listing_private_permission.key() == permission_pda(&private_details.key())
            @ VeilOtcError::InvalidPermissionAccount
    )]
    pub listing_private_permission: UncheckedAccount<'info>,
    /// CHECK: The executable program account is pinned to this program id.
    #[account(address = crate::ID)]
    pub veil_otc_program: UncheckedAccount<'info>,
    /// CHECK: Buffer PDA is derived from the delegated private account and this program id.
    #[account(
        mut,
        constraint = private_details_delegate_buffer.key()
            == delegate_buffer_pda(&private_details.key(), &veil_otc_program.key())
            @ VeilOtcError::InvalidDelegationAccount
    )]
    pub private_details_delegate_buffer: UncheckedAccount<'info>,
    /// CHECK: Delegation record PDA is derived from the delegated private account.
    #[account(
        mut,
        constraint = private_details_delegation_record.key()
            == delegation_record_pda(&private_details.key())
            @ VeilOtcError::InvalidDelegationAccount
    )]
    pub private_details_delegation_record: UncheckedAccount<'info>,
    /// CHECK: Delegation metadata PDA is derived from the delegated private account.
    #[account(
        mut,
        constraint = private_details_delegation_metadata.key()
            == delegation_metadata_pda(&private_details.key())
            @ VeilOtcError::InvalidDelegationAccount
    )]
    pub private_details_delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: Program address is pinned to the MagicBlock permission program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: Buffer PDA is derived from the delegated permission account and permission program.
    #[account(
        mut,
        constraint = private_permission_delegate_buffer.key()
            == delegate_buffer_pda(&listing_private_permission.key(), &permission_program.key())
            @ VeilOtcError::InvalidDelegationAccount
    )]
    pub private_permission_delegate_buffer: UncheckedAccount<'info>,
    /// CHECK: Delegation record PDA is derived from the permission account.
    #[account(
        mut,
        constraint = private_permission_delegation_record.key()
            == delegation_record_pda(&listing_private_permission.key())
            @ VeilOtcError::InvalidDelegationAccount
    )]
    pub private_permission_delegation_record: UncheckedAccount<'info>,
    /// CHECK: Delegation metadata PDA is derived from the permission account.
    #[account(
        mut,
        constraint = private_permission_delegation_metadata.key()
            == delegation_metadata_pda(&listing_private_permission.key())
            @ VeilOtcError::InvalidDelegationAccount
    )]
    pub private_permission_delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: Program address is pinned to the MagicBlock delegation program.
    #[account(address = DELEGATION_PROGRAM_ID)]
    pub delegation_program: UncheckedAccount<'info>,
    /// CHECK: Validator account is forwarded to MagicBlock CPIs.
    pub validator: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateListingPrivate<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        has_one = seller @ VeilOtcError::UnauthorizedSeller,
        has_one = private_details @ VeilOtcError::InvalidPrivateAccount
    )]
    pub listing_shell: Account<'info, ListingShell>,
    #[account(
        mut,
        constraint = private_details.listing_shell == listing_shell.key() @ VeilOtcError::InvalidPrivateAccount,
        constraint = private_details.seller == seller.key() @ VeilOtcError::UnauthorizedSeller
    )]
    pub private_details: Account<'info, ListingPrivate>,
}

#[derive(Accounts)]
pub struct ManageListing<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, has_one = seller @ VeilOtcError::UnauthorizedSeller)]
    pub listing_shell: Account<'info, ListingShell>,
}

#[derive(Accounts)]
pub struct CreateBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,
    #[account(mut)]
    pub listing_shell: Account<'info, ListingShell>,
    #[account(
        init,
        payer = bidder,
        space = 8 + BidShell::INIT_SPACE,
        seeds = [b"bid", listing_shell.key().as_ref(), bidder.key().as_ref()],
        bump
    )]
    pub bid_shell: Account<'info, BidShell>,
    #[account(
        init,
        payer = bidder,
        space = 8 + BidPrivate::INIT_SPACE,
        seeds = [BID_PRIVATE_SEED, bid_shell.key().as_ref()],
        bump
    )]
    pub bid_private: Account<'info, BidPrivate>,
    /// CHECK: Permission PDA is derived from the private account key.
    #[account(
        mut,
        constraint = bid_private_permission.key() == permission_pda(&bid_private.key())
            @ VeilOtcError::InvalidPermissionAccount
    )]
    pub bid_private_permission: UncheckedAccount<'info>,
    /// CHECK: Program address is pinned to the MagicBlock permission program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateBidPrivate<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,
    pub listing_shell: Account<'info, ListingShell>,
    #[account(
        has_one = bidder @ VeilOtcError::UnauthorizedBidder,
        has_one = listing_shell @ VeilOtcError::BidDoesNotBelongToListing,
        has_one = private_details @ VeilOtcError::InvalidPrivateAccount
    )]
    pub bid_shell: Account<'info, BidShell>,
    /// CHECK: The PDA is derived from the bid shell and is delegated in this instruction.
    #[account(
        mut,
        seeds = [BID_PRIVATE_SEED, bid_shell.key().as_ref()],
        bump
    )]
    pub private_details: UncheckedAccount<'info>,
    /// CHECK: Permission PDA is derived from the private account key.
    #[account(
        mut,
        constraint = bid_private_permission.key() == permission_pda(&private_details.key())
            @ VeilOtcError::InvalidPermissionAccount
    )]
    pub bid_private_permission: UncheckedAccount<'info>,
    /// CHECK: The executable program account is pinned to this program id.
    #[account(address = crate::ID)]
    pub veil_otc_program: UncheckedAccount<'info>,
    /// CHECK: Buffer PDA is derived from the delegated private account and this program id.
    #[account(
        mut,
        constraint = private_details_delegate_buffer.key()
            == delegate_buffer_pda(&private_details.key(), &veil_otc_program.key())
            @ VeilOtcError::InvalidDelegationAccount
    )]
    pub private_details_delegate_buffer: UncheckedAccount<'info>,
    /// CHECK: Delegation record PDA is derived from the delegated private account.
    #[account(
        mut,
        constraint = private_details_delegation_record.key()
            == delegation_record_pda(&private_details.key())
            @ VeilOtcError::InvalidDelegationAccount
    )]
    pub private_details_delegation_record: UncheckedAccount<'info>,
    /// CHECK: Delegation metadata PDA is derived from the delegated private account.
    #[account(
        mut,
        constraint = private_details_delegation_metadata.key()
            == delegation_metadata_pda(&private_details.key())
            @ VeilOtcError::InvalidDelegationAccount
    )]
    pub private_details_delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: Program address is pinned to the MagicBlock permission program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: Buffer PDA is derived from the delegated permission account and permission program.
    #[account(
        mut,
        constraint = private_permission_delegate_buffer.key()
            == delegate_buffer_pda(&bid_private_permission.key(), &permission_program.key())
            @ VeilOtcError::InvalidDelegationAccount
    )]
    pub private_permission_delegate_buffer: UncheckedAccount<'info>,
    /// CHECK: Delegation record PDA is derived from the permission account.
    #[account(
        mut,
        constraint = private_permission_delegation_record.key()
            == delegation_record_pda(&bid_private_permission.key())
            @ VeilOtcError::InvalidDelegationAccount
    )]
    pub private_permission_delegation_record: UncheckedAccount<'info>,
    /// CHECK: Delegation metadata PDA is derived from the permission account.
    #[account(
        mut,
        constraint = private_permission_delegation_metadata.key()
            == delegation_metadata_pda(&bid_private_permission.key())
            @ VeilOtcError::InvalidDelegationAccount
    )]
    pub private_permission_delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: Program address is pinned to the MagicBlock delegation program.
    #[account(address = DELEGATION_PROGRAM_ID)]
    pub delegation_program: UncheckedAccount<'info>,
    /// CHECK: Validator account is forwarded to MagicBlock CPIs.
    pub validator: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateBidPrivate<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,
    pub listing_shell: Account<'info, ListingShell>,
    #[account(
        has_one = bidder @ VeilOtcError::UnauthorizedBidder,
        has_one = listing_shell @ VeilOtcError::BidDoesNotBelongToListing,
        has_one = private_details @ VeilOtcError::InvalidPrivateAccount
    )]
    pub bid_shell: Account<'info, BidShell>,
    #[account(
        mut,
        constraint = private_details.listing_shell == listing_shell.key() @ VeilOtcError::BidDoesNotBelongToListing,
        constraint = private_details.bid_shell == bid_shell.key() @ VeilOtcError::InvalidPrivateAccount,
        constraint = private_details.bidder == bidder.key() @ VeilOtcError::UnauthorizedBidder
    )]
    pub private_details: Account<'info, BidPrivate>,
}

#[derive(Accounts)]
pub struct SelectWinner<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, has_one = seller @ VeilOtcError::UnauthorizedSeller)]
    pub listing_shell: Account<'info, ListingShell>,
    #[account(
        mut,
        constraint = bid_shell.listing_shell == listing_shell.key()
            @ VeilOtcError::BidDoesNotBelongToListing
    )]
    pub bid_shell: Account<'info, BidShell>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateListingArgs {
    pub asset_name: String,
    pub symbol: String,
    pub category: String,
    pub settlement_asset: String,
    pub summary: String,
    pub ask_min_usd: u64,
    pub ask_max_usd: u64,
    pub allowlist: Vec<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateBidPrivateArgs {
    pub price_usd: u64,
    pub allocation_bps: u16,
    pub note: String,
}

#[account]
#[derive(InitSpace)]
pub struct ListingShell {
    pub seller: Pubkey,
    pub seed: u64,
    pub created_at: i64,
    pub updated_at: i64,
    pub ask_min_usd: u64,
    pub ask_max_usd: u64,
    pub status: ListingStatus,
    pub bump: u8,
    #[max_len(48)]
    pub asset_name: String,
    #[max_len(12)]
    pub symbol: String,
    #[max_len(32)]
    pub category: String,
    #[max_len(12)]
    pub settlement_asset: String,
    #[max_len(160)]
    pub summary: String,
    #[max_len(16)]
    pub allowlist: Vec<Pubkey>,
    pub private_details: Pubkey,
    pub winning_bid: Option<Pubkey>,
    #[max_len(160)]
    pub settlement_receipt: String,
}

#[account]
#[derive(InitSpace)]
pub struct ListingPrivate {
    pub listing_shell: Pubkey,
    pub seller: Pubkey,
    pub created_at: i64,
    pub updated_at: i64,
    #[max_len(256)]
    pub hidden_terms: String,
}

#[account]
#[derive(InitSpace)]
pub struct BidShell {
    pub listing_shell: Pubkey,
    pub bidder: Pubkey,
    pub private_details: Pubkey,
    pub created_at: i64,
    pub updated_at: i64,
    pub status: BidStatus,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BidPrivate {
    pub listing_shell: Pubkey,
    pub bid_shell: Pubkey,
    pub bidder: Pubkey,
    pub created_at: i64,
    pub updated_at: i64,
    pub price_usd: u64,
    pub allocation_bps: u16,
    #[max_len(160)]
    pub note: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ListingStatus {
    Bidding,
    Review,
    Settling,
    Closed,
    Archived,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BidStatus {
    Sealed,
    Selected,
}

#[error_code]
pub enum VeilOtcError {
    #[msg("Only the listing seller can perform this action.")]
    UnauthorizedSeller,
    #[msg("Only the bidder can update this bid.")]
    UnauthorizedBidder,
    #[msg("The listing is not currently accepting bids.")]
    ListingNotBidding,
    #[msg("The listing is not currently in seller review.")]
    ListingNotInReview,
    #[msg("The listing is not currently settling.")]
    ListingNotSettling,
    #[msg("Only closed listings can be archived.")]
    ListingNotClosed,
    #[msg("The seller cannot bid on their own listing.")]
    SellerCannotBid,
    #[msg("This bidder is not allowlisted for the selected listing.")]
    BidderNotAllowed,
    #[msg("The selected bid does not belong to this listing.")]
    BidDoesNotBelongToListing,
    #[msg("A winner must be selected before settlement can complete.")]
    WinnerNotSelected,
    #[msg("Ask range is invalid.")]
    InvalidAskRange,
    #[msg("String field exceeds the maximum supported length.")]
    FieldTooLong,
    #[msg("Allowlist exceeds the maximum supported size.")]
    AllowlistTooLarge,
    #[msg("Allocation must be between 1 and 10,000 basis points.")]
    InvalidAllocation,
    #[msg("The provided private account does not match the public shell.")]
    InvalidPrivateAccount,
    #[msg("The derived permission account does not match the expected PDA.")]
    InvalidPermissionAccount,
    #[msg("The derived delegation account does not match the expected PDA.")]
    InvalidDelegationAccount,
}

fn validate_listing_args(args: &CreateListingArgs) -> Result<()> {
    require!(
        args.ask_min_usd > 0 && args.ask_min_usd <= args.ask_max_usd,
        VeilOtcError::InvalidAskRange
    );
    require!(
        args.allowlist.len() <= MAX_ALLOWLIST_LEN,
        VeilOtcError::AllowlistTooLarge
    );
    require!(
        args.asset_name.len() <= MAX_ASSET_NAME_LEN,
        VeilOtcError::FieldTooLong
    );
    require!(args.symbol.len() <= MAX_SYMBOL_LEN, VeilOtcError::FieldTooLong);
    require!(
        args.category.len() <= MAX_CATEGORY_LEN,
        VeilOtcError::FieldTooLong
    );
    require!(
        args.settlement_asset.len() <= MAX_SETTLEMENT_ASSET_LEN,
        VeilOtcError::FieldTooLong
    );
    require!(args.summary.len() <= MAX_SUMMARY_LEN, VeilOtcError::FieldTooLong);

    Ok(())
}

fn validate_hidden_terms(hidden_terms: &str) -> Result<()> {
    require!(
        hidden_terms.len() <= MAX_HIDDEN_TERMS_LEN,
        VeilOtcError::FieldTooLong
    );
    Ok(())
}

fn validate_bid_args(args: &UpdateBidPrivateArgs) -> Result<()> {
    require!(args.price_usd > 0, VeilOtcError::InvalidAskRange);
    require!(
        args.allocation_bps > 0 && args.allocation_bps <= 10_000,
        VeilOtcError::InvalidAllocation
    );
    require!(args.note.len() <= MAX_NOTE_LEN, VeilOtcError::FieldTooLong);
    Ok(())
}

fn validate_receipt(settlement_receipt: &str) -> Result<()> {
    require!(
        settlement_receipt.len() <= MAX_RECEIPT_LEN,
        VeilOtcError::FieldTooLong
    );
    Ok(())
}

fn normalize_allowlist(allowlist: Vec<Pubkey>) -> Vec<Pubkey> {
    let mut normalized = Vec::<Pubkey>::new();
    for member in allowlist {
        if !normalized.contains(&member) {
            normalized.push(member);
        }
    }
    normalized
}

fn is_allowlisted(allowlist: &[Pubkey], bidder: &Pubkey) -> bool {
    allowlist.iter().any(|member| member == bidder)
}

fn build_listing_members(authority: Pubkey, allowlist: &[Pubkey]) -> MembersArgs {
    let mut members = vec![Member {
        flags: AUTHORITY_FLAG | VIEWER_FLAGS,
        pubkey: authority,
    }];

    members.extend(allowlist.iter().map(|member| Member {
        flags: VIEWER_FLAGS,
        pubkey: *member,
    }));

    MembersArgs {
        members: Some(dedupe_members(members)),
    }
}

fn build_bid_members(bidder: Pubkey, seller: Pubkey) -> MembersArgs {
    MembersArgs {
        members: Some(dedupe_members(vec![
            Member {
                flags: AUTHORITY_FLAG | VIEWER_FLAGS,
                pubkey: bidder,
            },
            Member {
                flags: VIEWER_FLAGS,
                pubkey: seller,
            },
        ])),
    }
}

fn dedupe_members(members: Vec<Member>) -> Vec<Member> {
    let mut deduped = Vec::<Member>::new();

    for member in members {
        if let Some(existing) = deduped.iter_mut().find(|entry| entry.pubkey == member.pubkey) {
            existing.flags |= member.flags;
        } else {
            deduped.push(member);
        }
    }

    deduped
}

fn create_permission_for_account<'info>(
    permission_program: &AccountInfo<'info>,
    permissioned_account: &AccountInfo<'info>,
    permission: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    members: MembersArgs,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut builder = CreatePermissionCpiBuilder::new(permission_program);
    builder
        .permissioned_account(permissioned_account)
        .permission(permission)
        .payer(payer)
        .system_program(system_program)
        .args(members);
    builder.invoke_signed(signer_seeds)?;
    Ok(())
}

fn delegate_private_account<'info>(
    payer: &AccountInfo<'info>,
    private_details: &AccountInfo<'info>,
    owner_program: &AccountInfo<'info>,
    delegate_buffer: &AccountInfo<'info>,
    delegation_record: &AccountInfo<'info>,
    delegation_metadata: &AccountInfo<'info>,
    delegation_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    pda_seeds: &[&[u8]],
    validator: &AccountInfo<'info>,
) -> Result<()> {
    delegate_account(
        DelegateAccounts {
            payer,
            pda: private_details,
            owner_program,
            buffer: delegate_buffer,
            delegation_record,
            delegation_metadata,
            delegation_program,
            system_program,
        },
        pda_seeds,
        DelegateConfig {
            validator: Some(*validator.key),
            ..DelegateConfig::default()
        },
    )?;

    Ok(())
}

fn delegate_permission_for_account<'info>(
    permission_program: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    permissioned_account: &AccountInfo<'info>,
    permission: &AccountInfo<'info>,
    delegate_buffer: &AccountInfo<'info>,
    delegation_record: &AccountInfo<'info>,
    delegation_metadata: &AccountInfo<'info>,
    delegation_program: &AccountInfo<'info>,
    validator: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    let mut builder = DelegatePermissionCpiBuilder::new(permission_program);
    builder
        .payer(authority)
        .authority(authority, true)
        .permissioned_account(permissioned_account, false)
        .permission(permission)
        .system_program(system_program)
        .owner_program(permission_program)
        .delegation_buffer(delegate_buffer)
        .delegation_record(delegation_record)
        .delegation_metadata(delegation_metadata)
        .delegation_program(delegation_program)
        .validator(Some(validator));
    builder.invoke()?;
    Ok(())
}

fn permission_pda(permissioned_account: &Pubkey) -> Pubkey {
    Permission::find_pda(permissioned_account).0
}

fn delegate_buffer_pda(delegated_account: &Pubkey, owner_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"buffer", delegated_account.as_ref()], owner_program).0
}

fn delegation_record_pda(delegated_account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"delegation", delegated_account.as_ref()], &DELEGATION_PROGRAM_ID)
        .0
}

fn delegation_metadata_pda(delegated_account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"delegation-metadata", delegated_account.as_ref()],
        &DELEGATION_PROGRAM_ID,
    )
    .0
}
