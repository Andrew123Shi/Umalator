use strict;
use warnings;
use v5.012;
use utf8;

use DBI;
use DBD::SQLite::Constants qw(:file_open);
use JSON::PP;
use Encode qw(encode decode);

if (!@ARGV) {
	die 'Usage: make_global_tracknames.pl master.mdb';
}

my $mastermdb = shift @ARGV;

my $db = DBI->connect("dbi:SQLite:$mastermdb", undef, undef, {
	sqlite_open_flags => SQLITE_OPEN_READONLY
});
$db->{RaiseError} = 1;

# Prefer established English spellings when regenerating.
my %name_overrides = (
	10101 => 'Ooi',
);

my $select = $db->prepare('SELECT [index], text FROM text_data WHERE category = 31 ORDER BY [index];');
$select->execute;

my ($id, $utf8name);
$select->bind_columns(\($id, $utf8name));

my %names;
while ($select->fetch) {
	my $raw = Encode::decode('utf8', $utf8name);
	my $en = $name_overrides{$id};
	unless (defined $en) {
		$en = $raw;
		$en =~ s/\s+Racecourse\s*$//i;
		$en =~ s/\s+$//;
	}
	# Global UI only uses the English slot.
	$names{$id} = ['', $en];
}

my $json = JSON::PP->new;
$json->canonical(1);
$json->utf8(1);
say $json->encode(\%names);
